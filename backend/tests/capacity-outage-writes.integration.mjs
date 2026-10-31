import { exampleCommitment } from '../scripts/example-commitment.mjs'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { grantRuntime } from '../scripts/runtime-grants.mjs'
import { capacityOutageWrites } from '../scripts/capacity-outage-writes.mjs'
import { sandbox } from './helpers/database.mjs'

test('fault workload recovers ambiguous HTTP writes across two APIs and audits real PostgreSQL', async () => {
  const db = await sandbox()
  const apps = []
  const role = `outage_${randomUUID().replaceAll('-', '')}`
  let roleCreated = false
  try {
    const users = []
    for (let index = 0; index < 10; index++) {
      const user = await db.client.account.create({
        data: {
          loginName: randomUUID(),
          displayName: `Fault fixture ${index}`
        }
      })
      const token = randomBytes(32).toString('base64url')
      await db.client.session.create({
        data: {
          accountId: user.id,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000)
        }
      })
      users.push({ id: user.id, token })
    }
    const seller = await db.client.account.create({
      data: {
        loginName: randomUUID(),
        displayName: 'Fault fixture seller'
      }
    })
    const listings = []
    for (let index = 0; index < 8; index++) {
      const listing = await db.client.listing.create({
        data: {
          sellerId: seller.id,
          type: 'physical', commitment: exampleCommitment('physical'),
          commitmentVersion: 1,
          category: 'electronics',
          title: `Fault fixture ${index}`,
          description: `Real snapshot ${index}`,
          priceAmount: '10',
          currency: 'USD'
        }
      })
      await db.client.physicalInventory.create({ data: { listingId: listing.id } })
      listings.push(listing)
    }
    const password = randomUUID()
    await db.client.$executeRawUnsafe(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
    )
    roleCreated = true
    await grantRuntime(db.client, db.schema, role)
    const url = new URL(db.url)
    url.username = role
    url.password = password
    const addresses = []
    for (let index = 0; index < 2; index++) {
      const app = await createApp(readConfig({ DATABASE_URL: url.toString() }), false)
      apps.push(app)
      await app.listen({ port: 0, host: '127.0.0.1' })
      addresses.push(`http://127.0.0.1:${app.getHttpServer().address().port}`)
    }
    let attempts = 0,
      loseAcknowledgment = false,
      unavailable = false
    const post = async (path, payload, user, key) => {
      const address = addresses[attempts++ % addresses.length]
      // Controlled transport failures, not evidence of database failover.
      if (unavailable) return { status: 503, value: { code: 'DATABASE_UNAVAILABLE' } }
      const response = await fetch(`${address}${path}`, {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
          cookie: `bazaar_session=${user.token}`,
          'x-csrf-token': createHash('sha256').update(`csrf:${user.token}`).digest('hex'),
          'idempotency-key': key
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      })
      const value = await response.json()
      if (loseAcknowledgment && response.status === 200) {
        const error = new Error('Acknowledgment lost after real commit')
        error.code = 'ETIMEDOUT'
        throw error
      }
      return { status: response.status, value }
    }
    const workload = capacityOutageWrites(post, users, listings, 80)
    await workload.prepare()
    assert.equal(await db.client.order.count(), 4)
    loseAcknowledgment = true
    for (const index of [8, 9]) await assert.rejects(workload.send(index), { code: 'ETIMEDOUT' })
    assert.equal(await db.client.order.count(), 6, 'Timeout is not proof of rollback')
    loseAcknowledgment = false
    for (const index of [18, 19]) await workload.send(index)
    unavailable = true
    for (const index of [28, 29]) await assert.rejects(workload.send(index), { code: 'HTTP_503' })
    unavailable = false
    for (const index of [38, 39, 48, 49, 58, 59, 68, 69, 78, 79]) await workload.send(index)
    assert.equal(workload.summary().attemptedArrivals, 16)
    assert.equal(workload.summary().acknowledgedArrivals, 12)
    await workload.reconcile()
    assert.deepEqual(await workload.audit(db.client), {
      verifiedOrders: 8,
      verifiedPhysicalItems: 8,
      duplicateOrders: 0,
      duplicateEvents: 0
    })
    assert.equal(await db.client.order.count(), 8)
    const changed = await db.client.order.findFirstOrThrow({ where: { status: 'pending_payment' } })
    await db.market.act(changed.buyerId, randomUUID(), changed.id, 'cancel')
    await assert.rejects(workload.audit(db.client), { name: 'AssertionError' })
  } finally {
    for (const app of apps) await app.close()
    if (roleCreated) {
      await db.client.$executeRawUnsafe(`DROP OWNED BY "${role}"`)
      await db.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    }
    await db.close()
  }
})
