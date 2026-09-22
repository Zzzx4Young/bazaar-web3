import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { grantObserver } from '../scripts/observer-grants.mjs'
import { cli, connect, testUrl } from './helpers/database.mjs'

const denied = (error) =>
  ['25006', '42501'].includes(
    error.meta?.code ?? error.meta?.driverAdapterError?.cause?.originalCode
  )

test('I8: observer sees only curated views and cannot write or read private tables', async () => {
  const suffix = randomUUID().replaceAll('-', '')
  const sourceSchema = `observe_source_${suffix}`
  const observeSchema = `observe_safe_${suffix}`
  const owner = `om_${suffix}`
  const observer = `or_${suffix}`
  const inherited = `oi_${suffix}`
  const adminUrl = testUrl()
  const admin = await connect(adminUrl)
  const urls = []
  let ownerClient, observerClient
  try {
    for (const role of [owner, observer, inherited]) {
      const password = randomBytes(32).toString('hex')
      await admin.client.$executeRawUnsafe(
        `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
      )
      const url = new URL(adminUrl)
      url.username = role
      url.password = password
      urls.push(url)
    }
    await admin.client.$executeRawUnsafe(`ALTER ROLE "${observer}" SET default_transaction_read_only = on`)
    await admin.client.$executeRawUnsafe(`ALTER ROLE "${observer}" SET statement_timeout = '3s'`)
    await admin.client.$executeRawUnsafe(
      `ALTER ROLE "${observer}" SET search_path = "${observeSchema}", pg_catalog`
    )
    await admin.client.$executeRawUnsafe(`CREATE SCHEMA "${sourceSchema}" AUTHORIZATION "${owner}"`)
    await admin.client.$executeRawUnsafe(`CREATE SCHEMA "${observeSchema}" AUTHORIZATION "${owner}"`)
    const ownerUrl = new URL(urls[0])
    ownerUrl.searchParams.set('schema', sourceSchema)
    await cli(['migrate', 'deploy'], ownerUrl)
    ownerClient = await connect(ownerUrl)
    for (const [name, select] of Object.entries({
      accounts: `SELECT id, status, "createdAt" AS created_at FROM "${sourceSchema}"."Account"`,
      orders: `SELECT id, "listingId" AS listing_id, "buyerId" AS buyer_id,
        "sellerId" AS seller_id, status, version, "createdAt" AS created_at,
        "updatedAt" AS updated_at FROM "${sourceSchema}"."Order"`,
      refunds: `SELECT id, "orderId" AS order_id, "issueId" AS issue_id,
        "requestedBy" AS requested_by, status, "approvedBy" AS approved_by,
        "returnOutcome" AS return_outcome, "createdAt" AS created_at,
        "approvedAt" AS approved_at FROM "${sourceSchema}"."RefundRequest"`
    })) {
      await ownerClient.client.$executeRawUnsafe(
        `CREATE VIEW "${observeSchema}"."${name}" AS ${select}`
      )
    }
    await admin.client.$executeRawUnsafe(`GRANT "${inherited}" TO "${observer}"`)
    await assert.rejects(
      grantObserver(ownerClient.client, sourceSchema, observeSchema, observer),
      /without memberships/
    )
    await admin.client.$executeRawUnsafe(`REVOKE "${inherited}" FROM "${observer}"`)
    await grantObserver(ownerClient.client, sourceSchema, observeSchema, observer)
    await grantObserver(ownerClient.client, sourceSchema, observeSchema, observer)

    const observerUrl = new URL(urls[1])
    observerUrl.searchParams.set('schema', observeSchema)
    observerClient = await connect(observerUrl)
    const settings = await observerClient.client.$queryRawUnsafe(
      'SELECT current_setting(\'default_transaction_read_only\') AS read_only, current_setting(\'statement_timeout\') AS timeout'
    )
    assert.deepEqual(settings, [{ read_only: 'on', timeout: '3s' }])
    const viewCount = await observerClient.client.$queryRawUnsafe(
      `SELECT count(*)::int AS count FROM information_schema.views WHERE table_schema = '${observeSchema}'`
    )
    assert.deepEqual(viewCount, [{ count: 19 }])
    const columns = await observerClient.client.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = '${observeSchema}'`
    )
    const forbidden = new Set([
      'passwordhash',
      'tokenhash',
      'recipient',
      'contact',
      'address',
      'reference',
      'carrier',
      'accesscode',
      'description',
      'note',
      'key',
      'requesthash',
      'rates',
      'loginname',
      'displayname'
    ])
    assert.equal(columns.some(({ column_name }) => forbidden.has(column_name.toLowerCase())), false)
    await observerClient.client.$queryRawUnsafe(`SELECT * FROM "${observeSchema}".orders LIMIT 1`)
    for (const sql of [
      `SELECT * FROM "${sourceSchema}"."AccountCredential"`,
      `SELECT * FROM "${sourceSchema}"."Session"`,
      `SELECT * FROM "${sourceSchema}"."OrderShipping"`,
      `SELECT * FROM "${sourceSchema}"."DeliveryRecord"`,
      `CREATE TABLE "${observeSchema}".forbidden(id int)`,
      `DELETE FROM "${observeSchema}".orders`
    ])
      await assert.rejects(observerClient.client.$queryRawUnsafe(sql), denied)
  } finally {
    await observerClient?.onModuleDestroy()
    await ownerClient?.onModuleDestroy()
    await admin.client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${observeSchema}" CASCADE`)
    await admin.client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${sourceSchema}" CASCADE`)
    await admin.client.$executeRawUnsafe(`DROP ROLE IF EXISTS "${observer}"`)
    await admin.client.$executeRawUnsafe(`DROP ROLE IF EXISTS "${inherited}"`)
    await admin.client.$executeRawUnsafe(`DROP ROLE IF EXISTS "${owner}"`)
    await admin.onModuleDestroy()
  }
})
