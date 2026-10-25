import { readFileSync, writeFileSync } from 'node:fs'
import { type AppConfig } from '../config.js'
import { type EmailSender, normalizeGmail } from './email-code.js'

// A local test inbox. Never enable this sender in a deployed API.
export function createDevEmailSender(env: NodeJS.ProcessEnv,
  config: Pick<AppConfig, 'host' | 'appOrigin'>): EmailSender | null {
  if (env.EMAIL_CODE_DEV_INBOX_FILE === undefined) return null
  if (env.NODE_ENV !== 'development' || config.host !== '127.0.0.1' ||
    config.appOrigin !== 'http://localhost:3000' || !env.EMAIL_CODE_HMAC_KEY_FILE ||
    !env.EMAIL_CODE_DEV_ACCOUNT_FILE) {
    throw new Error('Development email inbox requires local development configuration')
  }
  const account = normalizeGmail(readFileSync(env.EMAIL_CODE_DEV_ACCOUNT_FILE, 'utf8').trim())
  const inboxFile = env.EMAIL_CODE_DEV_INBOX_FILE
  return {
    async send({ to, code, purpose }) {
      if (to !== account) throw new Error('Only the configured development account can receive codes')
      writeFileSync(inboxFile, JSON.stringify({ email: to, code, purpose,
        createdAt: new Date().toISOString() }) + '\n', { mode: 0o600 })
    }
  }
}
