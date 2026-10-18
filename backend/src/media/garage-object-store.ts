import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface GarageStoreConfig {
  hotEndpoint: string
  hotPublicEndpoint: string
  coldEndpoint: string
  hotCredentials: { accessKeyId: string; secretAccessKey: string }
  coldCredentials: { accessKeyId: string; secretAccessKey: string }
  hotBucket: string
  coldBucket: string
}

export class GarageObjectStore {
  private readonly hot: S3Client
  private readonly hotPublic: S3Client
  private readonly cold: S3Client

  constructor(private readonly config: GarageStoreConfig) {
    const client = (endpoint: string, credentials: GarageStoreConfig['hotCredentials']) =>
      new S3Client({
        endpoint,
        credentials,
        region: 'garage',
        forcePathStyle: true,
        requestChecksumCalculation: 'WHEN_REQUIRED'
      })
    this.hot = client(config.hotEndpoint, config.hotCredentials)
    this.hotPublic = client(config.hotPublicEndpoint, config.hotCredentials)
    this.cold = client(config.coldEndpoint, config.coldCredentials)
  }

  createUploadUrl(key: string, contentType: string, seconds: number) {
    return getSignedUrl(
      this.hotPublic,
      new PutObjectCommand({ Bucket: this.config.hotBucket, Key: key, ContentType: contentType }),
      { expiresIn: seconds }
    )
  }

  async headHot(key: string) {
    const value = await this.hot.send(new HeadObjectCommand({ Bucket: this.config.hotBucket, Key: key }))
    return { contentLength: value.ContentLength ?? null, contentType: value.ContentType ?? null }
  }

  private async read(client: S3Client, bucket: string, key: string, maxBytes?: number) {
    const value = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(maxBytes ? { Range: `bytes=0-${maxBytes - 1}` } : {})
    }))
    if (!value.Body) throw new Error('Garage object had no body')
    return {
      bytes: Buffer.from(await value.Body.transformToByteArray()),
      contentType: value.ContentType ?? 'application/octet-stream'
    }
  }

  readHot(key: string, maxBytes?: number) {
    return this.read(this.hot, this.config.hotBucket, key, maxBytes)
  }
  readCold(key: string, maxBytes?: number) {
    return this.read(this.cold, this.config.coldBucket, key, maxBytes)
  }

  async putCold(key: string, bytes: Buffer, contentType: string) {
    await this.cold.send(new PutObjectCommand({
      Bucket: this.config.coldBucket,
      Key: key,
      Body: bytes,
      ContentType: contentType
    }))
  }

  async putHot(key: string, bytes: Buffer, contentType: string) {
    await this.hot.send(new PutObjectCommand({
      Bucket: this.config.hotBucket,
      Key: key,
      Body: bytes,
      ContentType: contentType
    }))
  }

  async deleteHot(key: string) {
    await this.hot.send(new DeleteObjectCommand({ Bucket: this.config.hotBucket, Key: key }))
  }

  async deleteCold(key: string) {
    await this.cold.send(new DeleteObjectCommand({ Bucket: this.config.coldBucket, Key: key }))
  }

  private async list(client: S3Client, bucket: string, prefix: string, continuationToken?: string) {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, MaxKeys: 100,
      ...(continuationToken ? { ContinuationToken: continuationToken } : {})
    }))
    return {
      objects: (result.Contents ?? []).flatMap((item) =>
        item.Key && item.LastModified ? [{ key: item.Key, lastModified: item.LastModified }] : []),
      nextToken: result.NextContinuationToken
    }
  }

  listHot(prefix: string, continuationToken?: string) {
    return this.list(this.hot, this.config.hotBucket, prefix, continuationToken)
  }

  listCold(prefix: string, continuationToken?: string) {
    return this.list(this.cold, this.config.coldBucket, prefix, continuationToken)
  }
}
