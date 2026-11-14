import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
function path(root: string, name: string) {
  if (!/^[a-z][a-z0-9-]{0,60}$/.test(name)) throw new Error('Invalid backup part')
  return join(root, name + '.enc')
}
const aad = (id: string, name: string) =>
  Buffer.from(JSON.stringify(['bazaar-web3-private-backup-v1', id, name]))
export async function syncBackupDirectory(root: string) {
  const f = await open(root, 'r')
  try {
    await f.sync()
  } finally {
    await f.close()
  }
}
export async function encryptedPartHash(root: string, name: string) {
  const h = createHash('sha256')
  for await (const b of createReadStream(path(root, name))) h.update(b)
  return h.digest('hex')
}
export async function encryptBackupPart(
  root: string,
  id: string,
  name: string,
  key: Buffer,
  source: Readable
) {
  if (key.length !== 32) throw new Error('Backup key must be32bytes')
  const target = path(root, name),
    iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad(id, name))
  const out = createWriteStream(target, { flags: 'wx', mode: 0o600 })
  await new Promise<void>((ok, no) => {
    out.once('error', no)
    out.write(iv, (e) => (e ? no(e) : ok()))
  })
  await pipeline(source, cipher, out)
  const f = await open(target, 'a')
  try {
    await f.write(cipher.getAuthTag())
    await f.sync()
  } finally {
    await f.close()
  }
  await syncBackupDirectory(root)
  return encryptedPartHash(root, name)
}
export async function decryptBackupPart(
  root: string,
  id: string,
  name: string,
  key: Buffer,
  destination: string
) {
  if (key.length !== 32) throw new Error('Backup key must be32bytes')
  const target = path(root, name),
    f = await open(target, 'r'),
    iv = Buffer.alloc(12),
    tag = Buffer.alloc(16)
  let size: number
  try {
    size = (await f.stat()).size
    if (size < 28) throw new Error('Invalid encrypted backup')
    await f.read(iv, 0, 12, 0)
    await f.read(tag, 0, 16, size - 16)
  } finally {
    await f.close()
  }
  const cipher = createDecipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad(id, name))
  cipher.setAuthTag(tag)
  if (size === 28) {
    cipher.end()
    await pipeline(cipher, createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
  } else
    await pipeline(
      createReadStream(target, { start: 12, end: size - 17 }),
      cipher,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 })
    )
}
