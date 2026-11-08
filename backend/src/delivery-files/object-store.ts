import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat, link } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand
} from '@aws-sdk/client-s3'
import { DomainError } from '../common/domain-error.js'

export interface ObjectReceipt {
  bytes: number
  sha256: string
}
export type UploadCommit = (receipt: ObjectReceipt, finish: () => Promise<void>) => Promise<void>
export interface PrivateObjectStore {
  putOnce(
    key: string,
    source: Readable,
    exactBytes: number,
    contentType: string,
    commit?: UploadCommit,
    canContinue?: () => Promise<void>
  ): Promise<ObjectReceipt>
  read(key: string, signal?: AbortSignal): Promise<Readable>
  deleteAndConfirm(key: string): Promise<void>
}
export function byteGuard(exactBytes: number) {
  let bytes = 0
  const digest = createHash('sha256')
  const stream = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length
      if (bytes > exactBytes) {
        done(new DomainError('INVALID_INPUT'))
        return
      }
      digest.update(chunk)
      done(null, chunk)
    },
    flush(done) {
      done(bytes === exactBytes ? undefined : new DomainError('INVALID_INPUT'))
    }
  })
  return { stream, receipt: () => ({ bytes, sha256: digest.digest('hex') }) }
}
function objectPath(root: string, key: string) {
  if (!/^objects\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) throw new DomainError('INVALID_INPUT')
  return resolve(root, key)
}
export class LocalPrivateObjectStore implements PrivateObjectStore {
  constructor(private readonly root: string) {}
  async putOnce(
    key: string,
    source: Readable,
    exactBytes: number,
    _contentType: string,
    commit?: UploadCommit,
    canContinue?: () => Promise<void>
  ) {
    const path = objectPath(this.root, key),
      guard = byteGuard(exactBytes),
      part = path + '.part'
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await canContinue?.()
    await pipeline(source, guard.stream, createWriteStream(part, { flags: 'wx', mode: 0o600 }))
    const receipt = guard.receipt(),
      finish = async () => {
        await link(part, path)
        await rm(part)
      }
    if (commit) await commit(receipt, finish)
    else await finish()
    return receipt
  }
  async read(key: string, signal?: AbortSignal) {
    return createReadStream(objectPath(this.root, key), { signal })
  }
  async deleteAndConfirm(key: string) {
    const path = objectPath(this.root, key)
    await rm(path + '.part', { force: true })
    await rm(path, { force: true })
    try {
      await stat(path)
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') return
      throw e
    }
    throw new Error('Private object deletion not confirmed')
  }
}
export interface PrivateGarageConfig {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}
export class GaragePrivateObjectStore implements PrivateObjectStore {
  private readonly client: S3Client
  constructor(private readonly config: PrivateGarageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: 'garage',
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED'
    })
  }
  async putOnce(
    key: string,
    source: Readable,
    exactBytes: number,
    contentType: string,
    commit?: UploadCommit,
    canContinue?: () => Promise<void>
  ) {
    objectPath('/', key)
    await canContinue?.()
    const created = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType
      }),
      { abortSignal: AbortSignal.timeout(10000) }
    )
    const uploadId = created.UploadId
    if (!uploadId) throw new Error('Private multipart upload unavailable')
    const parts: { PartNumber: number; ETag: string }[] = [],
      digest = createHash('sha256')
    let bytes = 0,
      buffered = Buffer.alloc(0)
    const upload = async (part: Buffer) => {
      await canContinue?.()
      const number = parts.length + 1
      const result = await this.client.send(
        new UploadPartCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: number,
          Body: part,
          ContentLength: part.length
        }),
        { abortSignal: AbortSignal.timeout(30000) }
      )
      if (!result.ETag) throw new Error('Private multipart part was not acknowledged')
      parts.push({ PartNumber: number, ETag: result.ETag })
    }
    try {
      for await (const value of source) {
        const chunk = value as Buffer
        bytes += chunk.length
        if (bytes > exactBytes) throw new DomainError('INVALID_INPUT')
        digest.update(chunk)
        let offset = 0
        while (offset < chunk.length) {
          const count = Math.min(8_000_000 - buffered.length, chunk.length - offset)
          buffered = Buffer.concat([buffered, chunk.subarray(offset, offset + count)])
          offset += count
          if (buffered.length === 8_000_000) {
            await upload(buffered)
            buffered = Buffer.alloc(0)
          }
        }
      }
      if (bytes !== exactBytes) throw new DomainError('INVALID_INPUT')
      if (buffered.length) await upload(buffered)
      const receipt = { bytes, sha256: digest.digest('hex') }
      const finish = async () => {
        await this.client.send(
          new CompleteMultipartUploadCommand({
            Bucket: this.config.bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: { Parts: parts }
          }),
          { abortSignal: AbortSignal.timeout(10000) }
        )
      }
      if (commit) await commit(receipt, finish)
      else await finish()
      return receipt
    } catch (e) {
      await this.client
        .send(
          new AbortMultipartUploadCommand({
            Bucket: this.config.bucket,
            Key: key,
            UploadId: uploadId
          }),
          { abortSignal: AbortSignal.timeout(10000) }
        )
        .catch(() => {})
      throw e
    }
  }
  async read(key: string, signal?: AbortSignal) {
    objectPath('/', key)
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { abortSignal: signal }
    )
    if (!result.Body || !('pipe' in result.Body)) throw new Error('Private object unavailable')
    return result.Body as Readable
  }
  async deleteAndConfirm(key: string) {
    objectPath('/', key)
    // Abort every upload for this exact opaque key, including an initiation whose
    // response was lost. A fenced completion cannot race with cleanup.
    const list = await this.client.send(
      new ListMultipartUploadsCommand({ Bucket: this.config.bucket, Prefix: key, MaxUploads: 1000 })
    )
    if (list.IsTruncated) throw new Error('Private multipart cleanup requires continuation')
    for (const upload of list.Uploads ?? []) {
      if (upload.Key !== key || !upload.UploadId) continue
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: upload.UploadId
        })
      )
    }
    const after = await this.client.send(
      new ListMultipartUploadsCommand({ Bucket: this.config.bucket, Prefix: key, MaxUploads: 1000 })
    )
    if (after.IsTruncated || after.Uploads?.some((u) => u.Key === key))
      throw new Error('Private multipart cleanup not confirmed')
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }))
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }))
    } catch (e) {
      if (
        e &&
        typeof e === 'object' &&
        '$metadata' in e &&
        (e.$metadata as { httpStatusCode?: number }).httpStatusCode === 404
      )
        return
      throw e
    }
    throw new Error('Private object deletion not confirmed')
  }
}
