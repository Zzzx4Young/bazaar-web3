import { type PrismaClient } from '../generated/prisma/client.js'

// Run through the same connection as the API before accepting traffic.
export async function assertAuthRuntimeGrants(client: PrismaClient) {
  const missing = await client.$queryRaw<{ tableName: string; privilege: string }[]>`
    SELECT required."tableName", required."privilege"
    FROM (VALUES
      ('AccountIdentity', 'SELECT'),
      ('AccountIdentity', 'INSERT'),
      ('AccountIdentity', 'UPDATE'),
      ('GmailClaim', 'SELECT'),
      ('GmailClaim', 'INSERT'),
      ('GmailClaim', 'DELETE'),
      ('EmailCodeChallenge', 'SELECT'),
      ('EmailCodeChallenge', 'INSERT'),
      ('EmailCodeChallenge', 'UPDATE'),
      ('EmailCodeChallenge', 'DELETE'),
      ('GoogleOAuthAttempt', 'SELECT'),
      ('GoogleOAuthAttempt', 'INSERT'),
      ('GoogleOAuthAttempt', 'UPDATE'),
      ('GoogleOAuthAttempt', 'DELETE')
    ) AS required("tableName", "privilege")
    WHERE NOT has_table_privilege(current_user,
      format('%I.%I', current_schema(), required."tableName"), required."privilege")
  `
  if (missing.length) throw new Error('Missing auth runtime privileges')
}
