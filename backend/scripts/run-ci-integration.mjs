import { spawn } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { partitionIntegrationTests, requirePrivateChecks } from './ci-test-groups.mjs'

const name = process.argv[2]
const groups = partitionIntegrationTests((await readdir(new URL('../tests/', import.meta.url)))
  .filter((f) => f.endsWith('.integration.mjs')))
if (!Object.hasOwn(groups, name)) throw new Error('Select an explicit CI integration group')
if (name === 'private-files') requirePrivateChecks(process.env)
else {
  // Do not let a clean runner silently discover missing artifacts half way through DB acceptance.
  for (const contract of ['BazaarTestToken', 'BazaarEscrow', 'Safe', 'SafeProxy', 'LockedSafeGuard']) {
    const artifact = JSON.parse(await readFile(new URL(
      `../../contracts/out/${contract}.sol/${contract}.json`, import.meta.url), 'utf8'))
    if (!artifact.abi?.length || !artifact.bytecode?.object)
      throw new Error('Unbuilt local contract artifact: ' + contract)
  }
}
const child = spawn(process.execPath,
  ['--test', '--test-reporter=tap', '--test-concurrency=1', ...groups[name].map((f) => 'tests/' + f)],
  { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
let tail = '', skipped = false
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk)
  const text = tail + String(chunk)
  if (/# SKIP\b/.test(text)) skipped = true
  tail = text.slice(-100)
})
child.stderr.pipe(process.stderr)
const code = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code) => resolve(code ?? 1))
})
if (skipped && code === 0) console.error('Mandatory CI integration group contained skipped tests')
process.exitCode = code || (skipped ? 1 : 0)
