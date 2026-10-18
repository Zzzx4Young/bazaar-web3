import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3'

const secretDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../infra/.secrets/garage-app')
const secret = (name) => readFileSync(resolve(secretDir, name), 'utf8').trim()
const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000'
const parsed = new URL(origin)
if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol))
  throw new Error('APP_ORIGIN must be an exact origin')

const client = new S3Client({
  endpoint: process.env.GARAGE_HOT_ENDPOINT ?? 'http://127.0.0.1:3900',
  region: 'garage',
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: secret('hot_access_key_id'),
    secretAccessKey: secret('hot_secret_key')
  }
})
try {
  await client.send(new PutBucketCorsCommand({
    Bucket: 'bazaar-hot',
    CORSConfiguration: {
      CORSRules: [{
        AllowedOrigins: [origin],
        AllowedMethods: ['PUT'],
        AllowedHeaders: ['content-type'],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 300
      }]
    }
  }))
  process.stdout.write('Garage hot upload CORS ready\n')
} finally {
  client.destroy()
}
