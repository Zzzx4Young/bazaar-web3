import { createHash } from 'node:crypto'
import { readFileSync, readlinkSync } from 'node:fs'
export interface ProcessIdentity {
  scope: string
  pid: number
  start: string
}
function state(pid: number) {
  const text = readFileSync(`/proc/${pid}/stat`, 'utf8'),
    fields = text
      .slice(text.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/)
  if (fields.length < 20 || !/^\d+$/.test(fields[19])) throw new Error('Unknown process identity')
  return { state: fields[0], start: fields[19] }
}
export function processIdentity(): ProcessIdentity {
  return {
    scope: createHash('sha256')
      .update(
        readFileSync('/proc/sys/kernel/random/boot_id', 'utf8') + readlinkSync('/proc/self/ns/pid')
      )
      .digest('hex'),
    pid: process.pid,
    start: state(process.pid).start
  }
}
// Only a matching host boot and PID namespace can prove a process has exited.
// Unknown/remote owners retain their protection until an explicit acknowledgement.
export function processHasExited(owner: {
  scope: string | null
  pid: number | null
  start: string | null
}): boolean {
  const current = processIdentity()
  if (!owner.scope || !owner.pid || !owner.start || owner.scope !== current.scope) return false
  try {
    const active = state(owner.pid)
    return active.start !== owner.start || ['Z', 'X'].includes(active.state)
  } catch (e) {
    return Boolean(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')
  }
}
