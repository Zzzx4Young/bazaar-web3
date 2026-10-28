export function planGmailAccounts(accounts) {
  const keys = new Set()
  return accounts.map(({ id, loginName }) => {
    const from = loginName
    const normalized = loginName.toLowerCase()
    const [prefix, domain, extra] = normalized.split('@')
    if (extra !== undefined || (domain !== undefined &&
      !['test.com', 'gmail.com'].includes(domain)))
      throw new Error('Unexpected development account domain')
    if (domain === 'gmail.com' && /[_-]/.test(prefix))
      throw new Error('Gmail address would change recipient; review it manually')
    const local = prefix.replaceAll(/[_-]/g, '.')
    if (local.length < 6 || local.length > 30 ||
      !/^[a-z0-9](?:[a-z0-9.]*[a-z0-9])$/.test(local) || local.includes('..'))
      throw new Error('Invalid migrated Gmail username')
    const to = `${local}@gmail.com`
    const key = `${local.replaceAll('.', '')}@gmail.com`
    if (keys.has(key)) throw new Error('Gmail identity collision in migration plan')
    keys.add(key)
    return { id, from, to, key }
  })
}
