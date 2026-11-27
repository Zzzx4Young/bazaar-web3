import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const image = process.env.PRIVATE_FILE_CHECK_IMAGE
if (!/^sha256:[a-f0-9]{64}$/.test(image ?? '')) throw new Error('Pin immutable checker image')
const docker = (args) => execFileSync(process.env.DOCKER_USE_SUDO === '1' ? 'sudo' : 'docker',
  [...(process.env.DOCKER_USE_SUDO === '1' ? ['-n', 'docker'] : []), ...args],
  { encoding: 'utf8' }).trim()
const run = (entry, args) => docker(['run', '--rm', '--network=none', '--read-only',
  '--cap-drop=ALL', '--security-opt=no-new-privileges', '--entrypoint', entry, image, ...args])
const source = createHash('sha256').update(await readFile('backend/file-checker/file_checker.py')).digest('hex')
const included = run('sha256sum', ['/checker/file_checker.py']).split(/\s+/)[0]
if (included !== source) throw new Error('Checker image and reviewed source differ')
const evidence = { image, sourceSha256: source, includedSha256: included,
  clamav: run('clamscan', ['--version']), packages: run('apk', ['--no-network', 'info', '--installed', '-v', 'python3', 'py3-pillow', 'qpdf']) }
await mkdir('.tmp/ci', { recursive: true })
await writeFile('.tmp/ci/checker.json', JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify(evidence))
