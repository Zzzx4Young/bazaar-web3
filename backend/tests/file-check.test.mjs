import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const checker = fileURLToPath(new URL('../file-checker', import.meta.url))
function zipCase(kind) {
  const dir = mkdtempSync(join(tmpdir(), 'bazaar-zip-')),
    file = join(dir, 'file.zip')
  const program = `import zipfile,sys,stat,struct,binascii\np=sys.argv[1]; k=sys.argv[2]\nwith zipfile.ZipFile(p,'w',compression=zipfile.ZIP_DEFLATED) as z:\n if k=='valid': z.writestr('src/readme.txt','A small source fixture')\n elif k=='path': z.writestr('../outside','no')\n elif k=='backslash': z.writestr('folder\\\\..\\\\outside','no')\n elif k=='symlink':\n  i=zipfile.ZipInfo('link');i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,'outside')\n elif k=='nested': z.writestr('not-a-zip.txt',bytes.fromhex('504b0304')+b'zip inside')\n elif k=='bomb': z.writestr('repeated.txt','a'*1000000)\n elif k=='entries':\n  for i in range(10001): z.writestr(str(i),'')\n elif k=='valid-extra':\n  i=zipfile.ZipInfo('safe.txt');v=bytes([1])+struct.pack('<I',binascii.crc32(b'safe.txt'))+b'safe.txt';i.extra=struct.pack('<HH',0x7075,len(v))+v;z.writestr(i,'x')\n elif k=='extra-path':\n  i=zipfile.ZipInfo('safe.txt');v=b'\\x01'+struct.pack('<I',binascii.crc32(b'safe.txt'))+b'../outside';i.extra=struct.pack('<HH',0x7075,len(v))+v;z.writestr(i,'x')\n elif k=='unknown-link':\n  i=zipfile.ZipInfo('safe.txt');v=b'unknown-link-payload';i.extra=struct.pack('<HH',0x000d,len(v))+v;z.writestr(i,'x')\n elif k in ('bad-crc','encrypted'):\n  i=zipfile.ZipInfo('file.txt');i.compress_type=zipfile.ZIP_STORED;z.writestr(i,'ordinary test content')\n elif k=='empty': z.writestr('empty.txt','')\nif k in ('bad-crc','encrypted'):\n raw=bytearray(open(p,'rb').read())\n if k=='bad-crc': raw[38]^=1\n else:\n  central=raw.index(bytes.fromhex('504b0102'));struct.pack_into('<H',raw,6,struct.unpack_from('<H',raw,6)[0]|1);struct.pack_into('<H',raw,central+8,struct.unpack_from('<H',raw,central+8)[0]|1)\n open(p,'wb').write(raw)\n`
  try {
    const created = spawnSync('python3', ['-c', program, file, kind], { encoding: 'utf8' })
    assert.equal(created.status, 0, created.stderr)
    const result = spawnSync(
      'python3',
      [
        '-c',
        `import sys;sys.path.insert(0,sys.argv[1]);from file_checker import check_zip;check_zip(sys.argv[2]);print('ok')`,
        checker,
        file
      ],
      { encoding: 'utf8', timeout: 10000 }
    )
    return result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
for (const kind of ['valid', 'empty', 'valid-extra'])
  test(`T05 structural ZIP accepts ${kind}`, () => {
    const r = zipCase(kind)
    assert.equal(r.status, 0, r.stderr)
  })
for (const kind of [
  'path',
  'backslash',
  'symlink',
  'nested',
  'bomb',
  'entries',
  'extra-path',
  'unknown-link'
])
  test(`T05 structural ZIP rejects ${kind}`, () => {
    const r = zipCase(kind)
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /UnsafeFile/)
    assert.doesNotMatch(r.stderr, /ModuleNotFoundError/)
  })
test('T05 structural ZIP rejects non-archive bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bazaar-not-zip-')),
    file = join(dir, 'file.zip')
  try {
    writeFileSync(file, 'plain text')
    const r = spawnSync(
      'python3',
      [
        '-c',
        `import sys;sys.path.insert(0,sys.argv[1]);from file_checker import check_zip;check_zip(sys.argv[2])`,
        checker,
        file
      ],
      { encoding: 'utf8' }
    )
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /UnsafeFile/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('T05 structural ZIP validates actual member CRC and encryption flags', () => {
  const crc = zipCase('bad-crc')
  assert.notEqual(crc.status, 0)
  assert.match(crc.stderr, /ZIP_INTEGRITY/)
  const encrypted = zipCase('encrypted')
  assert.notEqual(encrypted.status, 0)
  assert.match(encrypted.stderr, /ZIP_ENCRYPTED_OR_UNSUPPORTED_FLAGS/)
})
