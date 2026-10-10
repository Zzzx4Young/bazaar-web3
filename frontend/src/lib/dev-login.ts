export function getDevLoginCredentials() {
  if (process.env.NODE_ENV !== 'development') return null

  const loginName = process.env.NEXT_PUBLIC_DEV_LOGIN_NAME
  const password = process.env.NEXT_PUBLIC_DEV_LOGIN_PASSWORD
  return loginName && password ? { loginName, password } : null
}
