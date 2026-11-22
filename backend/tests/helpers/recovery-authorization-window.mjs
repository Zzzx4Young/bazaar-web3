// Clock injection belongs only to this isolated test helper.
export function recoveryAuthorizationWindow(now = () => Date.now()) {
  const issued = now()
  return {
    issuedAt: new Date(issued).toISOString(),
    expiresAt: new Date(issued + 300000).toISOString()
  }
}
