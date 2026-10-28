// Keep the accepted address shape aligned with backend/src/auth/email-code.ts.
// Delivery to the full address remains the final ownership check.
export function normalizeGmailInput(input: string): string | null {
  const email = input.trim().toLowerCase()
  if (email.length > 100 ||
      !/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?(?:\+[a-z0-9_-]+(?:\.[a-z0-9_-]+)*)?@gmail\.com$/.test(email) ||
      email.includes('..')) return null
  return email
}
