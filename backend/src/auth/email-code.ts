import { createHmac, randomInt } from 'node:crypto'
import { DomainError } from '../common/domain-error.js'

export type EmailCodePurpose = 'register' | 'login' | 'bind'
export type EmailCodeLocale = 'zh-CN' | 'en'

export interface EmailCodeMessage {
  subject: string
  text: string
  html: string
}

export interface EmailSender {
  send(input: {
    to: string
    locale: EmailCodeLocale
    purpose: EmailCodePurpose
    code: string
  }): Promise<void>
}

export function normalizeGmail(input: string): string {
  const email = input.trim().toLowerCase()
  if (
    email.length > 100 ||
    !/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?(?:\+[a-z0-9_-]+)?@gmail\.com$/.test(email) ||
    email.includes('..')
  ) throw new DomainError('INVALID_INPUT')
  return email
}

export function gmailIdentityKey(input: string): string {
  const email = normalizeGmail(input)
  return `${email.slice(0, email.indexOf('@')).split('+')[0].replaceAll('.', '')}@gmail.com`
}

export function createEmailCode(nextInt: (max: number) => number = randomInt): string {
  const value = nextInt(1_000_000)
  if (!Number.isInteger(value) || value < 0 || value >= 1_000_000)
    throw new Error('Invalid random code value')
  return String(value).padStart(6, '0')
}

export function codeDigest(
  key: Buffer,
  challengeId: string,
  email: string,
  purpose: EmailCodePurpose,
  code: string
): string {
  return createHmac('sha256', key)
    .update(JSON.stringify([challengeId, email, purpose, code]))
    .digest('hex')
}

export function emailCodeMessage(
  locale: EmailCodeLocale,
  purpose: EmailCodePurpose,
  code: string
): EmailCodeMessage {
  const zh = locale === 'zh-CN'
  const action = zh ? (purpose === 'bind' ? '绑定邮箱' : purpose === 'register' ? '注册' : '登录') :
    (purpose === 'bind' ? 'link your email' : purpose === 'register' ? 'sign up' : 'sign in')
  const subject = zh ? `Bazaar Web3 ${action}验证码` : `Bazaar Web3 code to ${action}`
  const text = zh
    ? `你的验证码是 ${code}，5 分钟内有效，仅可使用一次。若非本人操作，请忽略此邮件。`
    : `Your verification code is ${code}. It expires in 5 minutes and can be used once. If you did not request it, ignore this email.`
  return { subject, text, html: `<p>${text}</p>` }
}
