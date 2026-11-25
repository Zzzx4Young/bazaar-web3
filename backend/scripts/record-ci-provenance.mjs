import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const event = process.env.GITHUB_EVENT_PATH
  ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : {}
const locks = {}
for (const folder of ['backend', 'frontend', 'contracts'])
  locks[folder] = createHash('sha256').update(await readFile(folder + '/package-lock.json')).digest('hex')
const provenance = { event: process.env.GITHUB_EVENT_NAME ?? 'local',
  runId: process.env.GITHUB_RUN_ID ?? null, attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  job: process.env.GITHUB_JOB ?? null, checkout: git('rev-parse', 'HEAD'),
  checkoutTree: git('rev-parse', 'HEAD^{tree}'), parents: git('show', '-s', '--format=%P', 'HEAD').split(' '),
  head: event.pull_request?.head?.sha ?? git('rev-parse', 'HEAD'),
  base: event.pull_request?.base?.sha ?? null, node: process.version,
  npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(), lockSha256: locks }
const dir = '.tmp/ci'
await mkdir(dir, { recursive: true })
await writeFile(join(dir, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
console.log(JSON.stringify(provenance))
