export const migrationRole = 'bazaar_migrate'
export const runtimeRole = 'bazaar_runtime'
export const schema = 'bazaar'
export const database = 'bazaar_dev'

export function validateRecoveryTarget(value) {
  const source = new URL(value ?? '')
  if (
    !['postgres:', 'postgresql:'].includes(source.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(source.hostname) ||
    source.pathname !== `/${database}`
  )
    throw new Error('Only the loopback bazaar_dev database is allowed')
  return source
}

export function assertRestrictedRoles(roles, memberships, owners) {
  if (
    roles.length !== 2 ||
    roles.some(
      (role) =>
        !role.rolcanlogin ||
        role.rolsuper ||
        role.rolcreatedb ||
        role.rolcreaterole ||
        role.rolreplication ||
        role.rolbypassrls
    ) ||
    memberships.length > 0
  )
    throw new Error('Expected restricted application roles')
  if (owners.length !== 1 || owners[0].rolname !== migrationRole)
    throw new Error('Unexpected schema ownership')
}
