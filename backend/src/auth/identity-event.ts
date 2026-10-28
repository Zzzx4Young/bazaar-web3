import { randomUUID } from 'node:crypto'
import { type Transaction } from '../database/transaction.js'

export type IdentityProvider = 'email' | 'google'
export type IdentityEventAction = 'register' | 'bind' | 'replace' | 'reverify'
export type VerificationSource = 'email_delivery' | 'dev_inbox' | 'google_oidc'

export async function recordIdentityEvent(tx: Transaction, input: {
  accountId: string
  provider: IdentityProvider
  action: IdentityEventAction
  previousSubject?: string | null
  currentSubject: string
  previousEmail?: string | null
  currentEmail: string
  verificationSource: VerificationSource
}) {
  await tx.$executeRaw`
    INSERT INTO "AccountIdentityEvent" ("id", "accountId", "provider", "action",
      "previousSubject", "currentSubject", "previousEmail", "currentEmail",
      "verificationSource")
    VALUES (${randomUUID()}::uuid, ${input.accountId}::uuid, ${input.provider}, ${input.action},
      ${input.previousSubject ?? null}, ${input.currentSubject},
      ${input.previousEmail ?? null}, ${input.currentEmail}, ${input.verificationSource})`
}
