export const loginWindowSeconds = 60
export const loginIpLimit = 10
export const loginNameLimit = 5
export const maxConcurrentHashesPerInstance = 2
export const sessionMaxAgeSeconds = 12 * 60 * 60
export const rateBucketCleanupIntervalMs = 60 * 1000
export const rateBucketCleanupBatchSize = 10_000

export const credentialInputPolicy = Object.freeze({
  passwordMinLength: 15,
  passwordMaxLength: 128,
  passwordMaxBytes: 512,
  loginMinLength: 3,
  loginMaxLength: 100
})
