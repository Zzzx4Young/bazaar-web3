import { connect, testUrl } from '../tests/helpers/database.mjs'
const url = testUrl()
if (url.hostname !== '127.0.0.1' || !url.port || [5432, 55432, 55433].includes(Number(url.port)))
  throw new Error('Explicit dedicated CI cluster required')
const database = await connect(url)
try {
  const [identity] = await database.client.$queryRaw`
    SELECT current_database() AS database, current_user AS role,
      system_identifier::text AS cluster, current_setting('server_version') AS version
    FROM pg_control_system()
  `
  const databases = await database.client.$queryRaw`
    SELECT datname AS name FROM pg_database
    WHERE datname NOT IN ('postgres','template0','template1','bazaar_test') ORDER BY datname
  `
  console.log(JSON.stringify({ port: Number(url.port), identity, extraDatabases: databases }))
} finally {
  await database.onModuleDestroy()
}
