import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { grantRuntime } from '../scripts/runtime-grants.mjs'
import { cli, connect, fixture, testUrl } from './helpers/database.mjs'
import { OrderCommands } from '../dist/orders/order-commands.js'
import { ListingCommands } from '../dist/listings/listing-commands.js'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { hashPassword } from '../dist/auth/password.js'

const permissionDenied = (error) =>
  (error.meta?.code ?? error.meta?.driverAdapterError?.cause?.originalCode) === '42501'

test('C1: migration owner and restricted runtime support transactions without DDL privileges', async () => {
  const suffix = randomUUID().replaceAll('-', '')
  const schema = `roles_${suffix}`
  const owner = `m_${suffix}`
  const runtime = `r_${suffix}`
  const adminUrl = testUrl()
  const admin = await connect(adminUrl)
  const created = []
  let migration,
    app,
    schemaCreated = false
  try {
    const urls = []
    for (const role of [owner, runtime]) {
      const password = randomBytes(32).toString('hex')
      await admin.client.$executeRawUnsafe(
        `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
      )
      created.push(role)
      const url = new URL(adminUrl)
      url.username = role
      url.password = password
      url.searchParams.set('schema', schema)
      urls.push(url)
    }
    await admin.client.$executeRawUnsafe(`CREATE SCHEMA "${schema}" AUTHORIZATION "${owner}"`)
    schemaCreated = true
    await cli(['migrate', 'deploy'], urls[0])
    migration = await connect(urls[0])
    await grantRuntime(migration.client, schema, runtime)
    await grantRuntime(migration.client, schema, runtime)
    app = await connect(urls[1])
    const commands = new OrderCommands(app.client)
    const listings = new ListingCommands(app.client)
    const f = await fixture({ client: app.client })
    await listings.edit(f.seller, f.listing.id, 1, { title: 'Runtime edit' })
    const key = randomUUID()
    const input = { ...f.input, version: 2 }
    const id = await commands.create(f.buyer, key, input)
    assert.equal(await commands.create(f.buyer, key, input), id)
    await commands.act(f.buyer, randomUUID(), id, 'pay')
    await commands.act(f.seller, randomUUID(), id, 'deliver', { reference: 'virtual' })
    await commands.act(f.buyer, randomUUID(), id, 'accept')
    assert.equal((await app.client.order.findUniqueOrThrow({ where: { id } })).status, 'completed')
    const account = await app.client.account.findUniqueOrThrow({ where: { id: f.buyer } })
    const password = 'Virtual-runtime-test-password'
    await migration.client.accountCredential.create({
      data: { accountId: f.buyer, passwordHash: await hashPassword(password) }
    })
    const http = await createApp(readConfig({ DATABASE_URL: urls[1].toString() }), false)
    try {
      const login = await http.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: 'http://localhost:3000' },
        payload: { loginName: account.loginName, password }
      })
      assert.equal(login.statusCode, 200, login.body)
      const logout = await http.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          origin: 'http://localhost:3000',
          cookie: login.headers['set-cookie'].split(';')[0],
          'x-csrf-token': login.json().csrfToken
        },
        payload: {}
      })
      assert.equal(logout.statusCode, 204)
    } finally {
      await http.close()
    }
    for (const sql of [
      'CREATE TABLE forbidden (id int)',
      'ALTER TABLE "Listing" ADD COLUMN forbidden int',
      'TRUNCATE "IdempotencyRecord"',
      'DELETE FROM "OrderEvent"',
      'UPDATE "OrderSnapshot" SET title = title',
      'SELECT * FROM "_prisma_migrations"',
      'UPDATE "AccountCredential" SET "passwordHash" = "passwordHash"',
      `SET ROLE "${owner}"`
    ]) {
      await assert.rejects(app.client.$executeRawUnsafe(sql), permissionDenied)
    }
    await migration.client.$executeRawUnsafe('CREATE TABLE future_table (id int)')
    await assert.rejects(app.client.$queryRawUnsafe('SELECT * FROM future_table'), permissionDenied)
  } finally {
    await app?.onModuleDestroy()
    await migration?.onModuleDestroy()
    if (schemaCreated) await admin.client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
    for (const role of created.reverse())
      await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    await admin.onModuleDestroy()
  }
})
