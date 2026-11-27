// Independent observer. docker exec contributes a small measured overhead.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
const probe = `import json,pathlib,os
p=pathlib.Path('/sys/fs/cgroup')
r={}
for n in ['memory.current','memory.peak','memory.events','memory.max','memory.swap.max','cpu.stat','cpu.max','pids.current','pids.max']:
 try:r[n]=(p/n).read_text().strip()
 except OSError:r[n]=None
s=os.statvfs('/tmp');r['tmpUsedBytes']=(s.f_blocks-s.f_bfree)*s.f_frsize
r['pid1Children']=pathlib.Path('/proc/1/task/1/children').read_text().strip()
print(json.dumps(r))`
export function observeFileCheck(id, intervalMs = 200) {
  if (!Number.isInteger(intervalMs) || intervalMs < 200 || intervalMs > 2000)
    throw new Error('Observer interval must be 200–2000 milliseconds')
  const name = 'bazaar-private-check-' + id
  const samples = []
  let stop = false
  const done = (async () => {
    while (!stop) {
      try {
        const { stdout } = await exec(
          'sudo',
          ['-n', 'docker', 'exec', name, 'python3', '-c', probe],
          { timeout: 3000 }
        )
        samples.push({ at: new Date().toISOString(), ...JSON.parse(stdout) })
      } catch {
        /* Startup/removal races are expected; no sample is invented. */
      }
      if (!stop) await new Promise((r) => setTimeout(r, intervalMs))
    }
  })()
  return async () => {
    stop = true
    await done
    let removed = false
    try {
      await exec('sudo', ['-n', 'docker', 'inspect', name], { timeout: 3000 })
    } catch (error) {
      removed = /No such (object|container)/i.test(error.stderr ?? '')
    }
    return {
      intervalMs,
      method: 'docker exec python3, read-only cgroup v2 and statvfs; observer overhead included',
      samples,
      removed
    }
  }
}
