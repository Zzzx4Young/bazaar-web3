import { closeSync, constants, fchmodSync, openSync, writeSync } from 'node:fs'
import { type AppConfig } from '../config.js'
import { type EmailSender, normalizeGmail } from './email-code.js'

// A local test inbox. Never enable this sender in a deployed API.
export function createDevEmailSender(env: NodeJS.ProcessEnv,
  config: Pick<AppConfig, 'host' | 'appOrigin'>): EmailSender | null {
  if (env.EMAIL_CODE_DEV_INBOX_FILE === undefined) return null
  if (env.NODE_ENV !== 'development' || config.host !== '127.0.0.1' ||
    config.appOrigin !== 'http://localhost:3000' || !env.EMAIL_CODE_HMAC_KEY_FILE) {
    throw new Error('Development email inbox requires local development configuration')
  }
  const inboxFile = env.EMAIL_CODE_DEV_INBOX_FILE
  return {
    provenance: 'dev_inbox',
    async send({ to, code, purpose, challengeId }) {
      if (normalizeGmail(to) !== to) throw new Error('Development recipient must be normalized')
      const fd = openSync(inboxFile,
        constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      try {
        fchmodSync(fd, 0o600)
        writeSync(fd, JSON.stringify({ email: to, code, purpose, challengeId,
          createdAt: new Date().toISOString() }) + '\n')
      } finally { closeSync(fd) }
    }
  }
}
