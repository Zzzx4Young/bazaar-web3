import { gmailIdentityKey } from './email-code.js'

type AccountRow = { id: string; loginName: string }
type IdentityRow = { accountId: string; provider: string; subject: string; email: string }
type ClaimRow = { key: string; accountId: string }
export type GmailClaimIssue = {
  kind: 'invalid_address' | 'email_identity_mismatch' | 'collision' |
    'missing' | 'wrong_owner' | 'unbacked'
  accountId: string
  claimedBy?: string
}

export function findGmailClaimIssues(input: {
  accounts: AccountRow[]
  identities: IdentityRow[]
  claims: ClaimRow[]
}): GmailClaimIssue[] {
  const issues: GmailClaimIssue[] = []
  const expected = new Map<string, string>()
  const add = (address: string, accountId: string) => {
    let key: string
    try { key = gmailIdentityKey(address) } catch {
      issues.push({ kind: 'invalid_address', accountId })
      return
    }
    const owner = expected.get(key)
    if (owner && owner !== accountId)
      issues.push({ kind: 'collision', accountId, claimedBy: owner })
    else expected.set(key, accountId)
  }
  for (const account of input.accounts) {
    if (account.loginName.toLowerCase().endsWith('@gmail.com'))
      add(account.loginName, account.id)
  }
  for (const identity of input.identities) {
    if (identity.provider === 'email') {
      if (identity.subject !== identity.email)
        issues.push({ kind: 'email_identity_mismatch', accountId: identity.accountId })
      add(identity.subject, identity.accountId)
    } else if (identity.provider === 'google') add(identity.email, identity.accountId)
  }
  const actual = new Map(input.claims.map(claim => [claim.key, claim.accountId]))
  for (const [key, owner] of expected) {
    const claimedBy = actual.get(key)
    if (!claimedBy) issues.push({ kind: 'missing', accountId: owner })
    else if (claimedBy !== owner)
      issues.push({ kind: 'wrong_owner', accountId: owner, claimedBy })
  }
  for (const claim of input.claims) {
    if (!expected.has(claim.key))
      issues.push({ kind: 'unbacked', accountId: claim.accountId })
  }
  return issues
}
