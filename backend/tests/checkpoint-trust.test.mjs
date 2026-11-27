import assert from 'node:assert/strict'
import { test, before } from 'node:test'
import process from 'node:process'
import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
let code
before(async () => {
  try {
    const source = await fs.readFile(
      new URL('../src/auth/checkpoint-trust.ts', import.meta.url),
      'utf8'
    )
    code = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    }).outputText
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
})
function load(filesystem = fs, runtime = process) {
  assert.equal(typeof code, 'string', 'checkpoint trust validator is implemented')
  const exports = {}
  runInNewContext(code, {
    exports,
    require: (name) => {
      if (name === 'node:fs/promises') return filesystem
      if (name === 'node:process') return runtime
      return require(name)
    }
  })
  assert.equal(typeof exports.assertRuntimeTrustFiles, 'function')
  return exports.assertRuntimeTrustFiles
}

// Permission/ACL unit model only: it does not impersonate another kernel UID.
// Parent browser acceptance supplies the real dropped-UID custodial fixture.
function model() {
  const nodes = new Map()
  const dir = (uid, mode, writable = false) => ({
    uid,
    mode,
    writable,
    type: 'directory',
    nlink: 2
  })
  nodes.set('/', dir(0, 0o755))
  nodes.set('/tmp', dir(0, 0o1777, true))
  nodes.set('/tmp/custodian', dir(1000, 0o755))
  nodes.set('/tmp/custodian/public', dir(1000, 0o755))
  const file = '/tmp/custodian/public/key.pem'
  nodes.set(file, { uid: 1000, gid: 1000, mode: 0o644, writable: false, type: 'file', nlink: 1 })
  const runtime = {
    getuid: () => 65534,
    geteuid: () => 65534,
    getgid: () => 65534,
    getegid: () => 65534,
    getgroups: () => [65534, 1000]
  }
  const errno = (code) => Object.assign(new Error('fixture error'), { code })
  function node(name) {
    if (!nodes.has(name)) throw errno('ENOENT')
    return nodes.get(name)
  }
  const filesystem = {
    realpath: async (name) => {
      node(name)
      return node(name).canonical ?? name
    },
    lstat: async (name) => ({
      ...node(name),
      isFile: () => node(name).type === 'file',
      isDirectory: () => node(name).type === 'directory',
      isSymbolicLink: () => node(name).type === 'symlink'
    }),
    access: async (name, mode) => {
      assert.equal(mode, constants.W_OK)
      const entry = node(name)
      if (entry.accessError) throw errno(entry.accessError)
      if (!entry.writable) throw errno('EACCES')
    }
  }
  return { file, nodes, runtime, check: (paths) => load(filesystem, runtime)(paths) }
}

test('real same-owner public files are rejected even when chmod removes write bits', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'checkpoint-trust-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'checkpoint.json')
  await fs.writeFile(file, 'public synthetic checkpoint', { mode: 0o644 })
  for (const mode of [0o644, 0o444, 0o400]) {
    await fs.chmod(file, mode)
    await assert.rejects(load()([file]), /UNSAFE_RUNTIME_TRUST_FILES/)
    assert.equal(await fs.readFile(file, 'utf8'), 'public synthetic checkpoint')
  }
})

test('real independently owned public file with protected ancestry is accepted', async (t) => {
  if (process.getuid() === 0) {
    t.skip('root is intentionally rejected')
    return
  }
  // Metadata only; no host configuration or file contents are read or changed.
  await load()(['/etc/passwd'])
})

test('sticky /tmp permits a custodial child while runtime has supplementary custodial GID', async () => {
  const m = model()
  await m.check([m.file])
})

for (const [name, change] of [
  [
    'runtime-owned read-only file',
    (m) => {
      Object.assign(m.nodes.get(m.file), { uid: 65534, mode: 0o444 })
    }
  ],
  [
    'runtime-owned read-only immediate parent',
    (m) => {
      Object.assign(m.nodes.get('/tmp/custodian/public'), { uid: 65534, mode: 0o555 })
    }
  ],
  [
    'runtime-owned read-only distant ancestor',
    (m) => {
      Object.assign(m.nodes.get('/tmp/custodian'), { uid: 65534, mode: 0o555 })
    }
  ],
  [
    'group-writable file with supplementary group',
    (m) => {
      Object.assign(m.nodes.get(m.file), { mode: 0o664, writable: true })
    }
  ],
  [
    'ACL-writable file despite mode 0444',
    (m) => {
      Object.assign(m.nodes.get(m.file), { mode: 0o444, writable: true })
    }
  ],
  [
    'group-writable immediate parent',
    (m) => {
      Object.assign(m.nodes.get('/tmp/custodian/public'), { mode: 0o775, writable: true })
    }
  ],
  [
    'replaceable distant ancestor',
    (m) => {
      Object.assign(m.nodes.get('/tmp/custodian'), { mode: 0o777, writable: true })
    }
  ],
  [
    'ACL-writable ancestor despite mode 0555',
    (m) => {
      Object.assign(m.nodes.get('/tmp/custodian'), { mode: 0o555, writable: true })
    }
  ],
  [
    'non-sticky writable /tmp',
    (m) => {
      m.nodes.get('/tmp').mode = 0o777
    }
  ],
  [
    'runtime-owned sticky directory',
    (m) => {
      m.nodes.get('/tmp').uid = 65534
    }
  ],
  [
    'runtime-owned entry under sticky directory',
    (m) => {
      m.nodes.get('/tmp/custodian').uid = 65534
    }
  ],
  [
    'file symlink',
    (m) => {
      Object.assign(m.nodes.get(m.file), { type: 'symlink', canonical: '/elsewhere/key' })
    }
  ],
  [
    'ancestor symlink',
    (m) => {
      m.nodes.get('/tmp/custodian').type = 'symlink'
    }
  ],
  [
    'hardlinked file',
    (m) => {
      m.nodes.get(m.file).nlink = 2
    }
  ],
  [
    'directory in place of file',
    (m) => {
      m.nodes.get(m.file).type = 'directory'
    }
  ],
  [
    'FIFO in place of file',
    (m) => {
      m.nodes.get(m.file).type = 'fifo'
    }
  ],
  [
    'regular file in ancestry',
    (m) => {
      m.nodes.get('/tmp/custodian').type = 'file'
    }
  ],
  [
    'missing file',
    (m) => {
      m.nodes.delete(m.file)
    }
  ],
  [
    'unexpected access error',
    (m) => {
      m.nodes.get(m.file).accessError = 'EIO'
    }
  ],
  [
    'root runtime UID',
    (m) => {
      m.runtime.getuid = () => 0
      m.runtime.geteuid = () => 0
    }
  ],
  [
    'effective root runtime UID',
    (m) => {
      m.runtime.geteuid = () => 0
    }
  ],
  [
    'mismatched real and effective GID',
    (m) => {
      m.runtime.getegid = () => 1000
    }
  ]
]) {
  test(`trust rejects ${name}`, async () => {
    const m = model()
    change(m)
    await assert.rejects(m.check([m.file]), /UNSAFE_RUNTIME_TRUST_FILES/)
  })
}

for (const [name, paths] of [
  ['empty input', []],
  ['more than eight paths', Array(9).fill('/tmp/custodian/public/key.pem')],
  ['relative path', ['key.pem']],
  ['noncanonical absolute path', ['/tmp/custodian/public/../public/key.pem']],
  ['non-string path', [null]],
  ['non-array input', null]
]) {
  test(`trust rejects ${name}`, async () => {
    await assert.rejects(model().check(paths), /UNSAFE_RUNTIME_TRUST_FILES/)
  })
}

test('all supplied paths are checked and the eight-path limit is inclusive', async () => {
  const m = model()
  await m.check(Array(8).fill(m.file))
  const other = '/tmp/custodian/public/proof.json'
  m.nodes.set(other, { ...m.nodes.get(m.file), writable: true })
  await assert.rejects(m.check([m.file, other]), /UNSAFE_RUNTIME_TRUST_FILES/)
})
