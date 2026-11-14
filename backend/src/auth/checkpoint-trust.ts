import process from 'node:process'
import { constants } from 'node:fs'
import { access, lstat, realpath } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

async function writable(path: string) {
  try {
    // Kernel access checks include supplementary groups and ACLs. Require equal
    // real/effective credentials below because access uses the real credentials.
    await access(path, constants.W_OK)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') return false
    throw error
  }
}

/** Runtime-only trust boundary for externally pinned public keys/checkpoints.
 * No contents are read and no paths are created or changed. Runtime ownership
 * is unsafe even for 0444 files/0555 directories: the owner can chmod them.
 * Every ancestor is checked, including the parent of each directory entry.
 * A writable sticky directory is safe only when neither it nor the protected
 * child entry belongs to runtime (e.g. root-owned /tmp and a custodial child).
 * Custodial owners remain trusted to keep these paths stable during use; this
 * snapshot is not a lock against privileged/custodial concurrent replacement.
 */
export async function assertRuntimeTrustFiles(paths: string[]): Promise<void> {
  try {
    const uid = process.getuid?.(),
      gid = process.getgid?.()
    if (
      uid === undefined ||
      gid === undefined ||
      uid === 0 ||
      uid !== process.geteuid?.() ||
      gid !== process.getegid?.() ||
      !Array.isArray(paths) ||
      paths.length < 1 ||
      paths.length > 8
    )
      throw new Error('Invalid runtime trust boundary')
    for (const path of paths) {
      if (typeof path !== 'string' || resolve(path) !== path || (await realpath(path)) !== path)
        throw new Error('Invalid runtime trust path')
      let child = await lstat(path)
      if (!child.isFile() || child.nlink !== 1 || child.uid === uid || (await writable(path)))
        throw new Error('Mutable runtime trust file')
      let directory = dirname(path)
      for (;;) {
        const parent = await lstat(directory)
        if (!parent.isDirectory() || parent.uid === uid)
          throw new Error('Mutable runtime trust directory')
        if (await writable(directory)) {
          if (!(parent.mode & 0o1000) || child.uid === uid)
            throw new Error('Replaceable runtime trust entry')
        }
        const ancestor = dirname(directory)
        if (ancestor === directory) break
        child = parent
        directory = ancestor
      }
    }
  } catch {
    // Filesystem/parser diagnostics can contain caller paths; expose a code only.
    throw new Error('UNSAFE_RUNTIME_TRUST_FILES')
  }
}
