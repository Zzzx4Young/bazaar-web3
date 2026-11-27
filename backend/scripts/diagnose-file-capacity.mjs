// Diagnostic only: compare the fixed application tmpfs budget with a larger
// isolated tmpfs. Does not change DockerFileChecker or product file limits.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { observeFileCheck } from './observe-file-check.mjs'
const exec = promisify(execFile)
const root = resolve(process.argv[2])
const image = process.env.PRIVATE_FILE_CHECK_IMAGE ?? 'sha256:1cca08651d855df02dca36b7a6347da847c41be4ecae2b01ff2733adb4316498'
for (const tmpBytes of [64_000_000, 1_000_000_000]) {
  const id = randomUUID(),
    name = 'bazaar-private-check-' + id,
    finish = observeFileCheck(id)
  const args = [
    '-n',
    'timeout',
    '--signal=KILL',
    '--kill-after=2',
    '135s',
    'docker',
    'run',
    '--pull=never',
    '--name',
    name,
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--memory',
    '4000000000',
    '--memory-swap',
    '4000000000',
    '--cpus',
    '1',
    '--pids-limit',
    '32',
    '--user',
    '65532:65532',
    '--tmpfs',
    `/tmp:rw,noexec,nosuid,size=${tmpBytes}`,
    '--mount',
    `type=bind,source=${join(root, 'samples/zip-500000000.zip')},target=/input/object,readonly`,
    '--mount',
    `type=bind,source=${resolve('file-checker/control/diagnose-capacity.py')},target=/diagnose.py,readonly`,
    '--entrypoint',
    'python3',
    image,
    '/diagnose.py'
  ]
  let result, state, error
  try {
    result = await exec('sudo', args, { timeout: 140000, maxBuffer: 1_048_576 })
  } catch (e) {
    error = { message: e.message, stdout: e.stdout, stderr: e.stderr }
  }
  try {
    state = JSON.parse((await exec('sudo', ['-n', 'docker', 'inspect', name])).stdout)[0].State
  } finally {
    await exec('sudo', ['-n', 'docker', 'rm', '--force', name])
  }
  const observation = await finish()
  const evidence = {
    id,
    image,
    tmpBytes,
    diagnosticOnly: true,
    args,
    result,
    state,
    error,
    observation
  }
  await writeFile(
    join(root, `diagnostic-tmp-${tmpBytes}.json`),
    JSON.stringify(evidence, null, 2) + '\n',
    { mode: 0o600 }
  )
  console.log(tmpBytes, result?.stdout ?? error)
}
