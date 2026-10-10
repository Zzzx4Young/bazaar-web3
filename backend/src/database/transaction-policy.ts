export const transactionPolicy = Object.freeze({
  defaultAttempts: 3,
  maxAttempts: 5,
  defaultLockTimeoutMs: 2000,
  maxLockTimeoutMs: 2000,
  maxWaitMs: 3000,
  timeoutMs: 10000,
  retryBackoffMs: 10
})
