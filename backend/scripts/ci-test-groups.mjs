// Exhaustive, disjoint partitions. Resource-dependent tests have a separate mandatory job.
const privateFiles = [
  'file-check-capacity.integration.mjs',
  'file-check-product-capacity.integration.mjs',
  'file-check-resource.integration.mjs',
  'private-file-garage.integration.mjs'
]
export function partitionIntegrationTests(files) {
  if (new Set(files).size !== files.length) throw new Error('Duplicate integration test name')
  for (const name of privateFiles)
    if (!files.includes(name)) throw new Error('Missing required integration test: ' + name)
  const database = files.filter((f) => !privateFiles.includes(f)).sort()
  return {
    'database-a': database.filter((_, i) => i % 2 === 0),
    'database-b': database.filter((_, i) => i % 2 === 1),
    'private-files': [...privateFiles]
  }
}
export function requirePrivateChecks(env) {
  for (const key of ['PRIVATE_FILE_CHECK_IMAGE', 'PRIVATE_FILE_CONTROL_IMAGE',
    'PRIVATE_FILE_CAPACITY_SAMPLES', 'PRIVATE_GARAGE_ENDPOINT', 'PRIVATE_GARAGE_BUCKET',
    'PRIVATE_GARAGE_ACCESS_KEY_ID', 'PRIVATE_GARAGE_SECRET_KEY'])
    if (!env[key]) throw new Error('Missing required private-file check configuration: ' + key)
}
