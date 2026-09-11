import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { DatabaseService } from '../../dist/database/database.service.js'
import { OrderCommands } from '../../dist/orders/order-commands.js'
import { ListingCommands } from '../../dist/listings/listing-commands.js'

export function testUrl(value = process.env.TEST_DATABASE_URL, database = 'bazaar_test') {
  if (!value) throw new Error('Explicit TEST_DATABASE_URL is required')
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== `/${database}`)
    throw new Error('Unexpected test database')
  return url
}

export async function cli(args, url) {
  const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', ...args], {
    env: { ...process.env, DATABASE_URL: url.toString(), PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', (data) => {
    output += data
  })
  child.stderr.on('data', (data) => {
    output += data
  })
  const timer = setTimeout(() => child.kill('SIGTERM'), 30000)
  let code
  try {
    code = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', resolve)
    })
  } finally {
    clearTimeout(timer)
  }
  output = output.replaceAll(url.toString(), '[TEST_DATABASE_URL]')
  if (url.password) output = output.replaceAll(decodeURIComponent(url.password), '[REDACTED]')
  assert.equal(code, 0, output)
  return output
}

export async function connect(url) {
  const database = new DatabaseService(url.toString())
  try {
    await database.onModuleInit()
    return database
  } catch (error) {
    await database.onModuleDestroy()
    throw error
  }
}

export async function sandbox(base = testUrl(), migrate = true) {
  const url = new URL(base)
  const schema = `v2_${randomUUID().replaceAll('-', '')}`
  const adminUrl = new URL(base)
  adminUrl.searchParams.set('schema', 'public')
  const admin = await connect(adminUrl)
  await admin.client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
  url.searchParams.set('schema', schema)
  let database
  try {
    if (migrate) await cli(['migrate', 'deploy'], url)
    database = await connect(url)
    const orders = new OrderCommands(database.client)
    const listings = new ListingCommands(database.client)
    return {
      url,
      schema,
      database,
      client: database.client,
      market: {
        create: orders.create.bind(orders),
        act: orders.act.bind(orders),
        edit: listings.edit.bind(listings)
      },
      async read(work) {
        const reader = await connect(url)
        try {
          return await work(reader.client)
        } finally {
          await reader.onModuleDestroy()
        }
      },
      async close() {
        await database.onModuleDestroy()
        // Only the randomly named schema successfully created by this invocation is dropped.
        await admin.client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
        await admin.onModuleDestroy()
      }
    }
  } catch (error) {
    await database?.onModuleDestroy()
    await admin.client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
    await admin.onModuleDestroy()
    throw error
  }
}

export const shipping = {
  recipient: 'Test recipient',
  contact: 'virtual',
  address: 'Test address only'
}
export async function fixture(
  db,
  type = 'physical',
  price = '12345678901234567890.123456789012345678'
) {
  const accounts = []
  for (let i = 0; i < 3; i++)
    accounts.push(
      await db.client.account.create({
        data: { loginName: randomUUID(), displayName: `Fixture ${i}` }
      })
    )
  const [seller, buyer, other] = accounts.map((account) => account.id)
  const listing = await db.client.listing.create({
    data: {
      sellerId: seller,
      type,
      title: 'Version one',
      description: 'Virtual fixture',
      category: 'test',
      priceAmount: price,
      currency: 'TEST',
      licenseDescription: type === 'digital' ? 'Test license' : null,
      contentVersion: type === 'digital' ? 'v1' : null
    }
  })
  if (type === 'physical')
    await db.client.physicalInventory.create({ data: { listingId: listing.id } })
  return {
    seller,
    buyer,
    other,
    listing,
    input: { listingId: listing.id, version: 1, ...(type === 'physical' ? { shipping } : {}) }
  }
}

export function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export async function bounded(promise, message, ms = 5000) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

// The first transaction holds the real resource lock. Observe the second connection
// in pg_blocking_pids before releasing it; Promise.all alone is not a race assertion.
export async function race(db, first, second) {
  const locked = deferred(),
    release = deferred(),
    secondStarted = deferred()
  let firstPid, secondPid
  const firstPromise = first({
    checkpoint: async (stage, tx) => {
      if (stage === 'locked') {
        firstPid = (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid
        locked.resolve()
        await bounded(release.promise, 'First lock was not released')
      }
    }
  })
  firstPromise.catch(() => {})
  let secondPromise
  try {
    await bounded(locked.promise, 'First transaction did not lock')
    secondPromise = second({
      checkpoint: async (stage, tx) => {
        if (stage === 'begin') {
          secondPid = (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid
          secondStarted.resolve()
        }
      }
    })
    secondPromise.catch(() => {})
    await bounded(secondStarted.promise, 'Second transaction did not start')
    assert.notEqual(firstPid, secondPid)
    const observer = await connect(db.url)
    try {
      const deadline = Date.now() + 1500
      let waiting = false
      while (Date.now() < deadline) {
        const rows = await observer.client
          .$queryRaw`SELECT pg_blocking_pids(${secondPid}::int) AS blockers`
        if (rows[0].blockers.includes(firstPid)) {
          waiting = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      assert.equal(waiting, true, 'Second PostgreSQL connection must actually wait for the first')
    } finally {
      await observer.onModuleDestroy()
    }
    release.resolve()
    return await Promise.allSettled([firstPromise, secondPromise])
  } finally {
    release.resolve()
    await Promise.allSettled([firstPromise, ...(secondPromise ? [secondPromise] : [])])
  }
}

export async function orderState(db, id) {
  return db.read(async (client) => ({
    order: await client.order.findUniqueOrThrow({ where: { id } }),
    snapshots: await client.orderSnapshot.findMany({ where: { orderId: id } }),
    settlements: await client.settlementRecord.findMany({
      where: { orderId: id },
      orderBy: { operation: 'asc' }
    }),
    events: await client.orderEvent.findMany({ where: { orderId: id } }),
    reservations: await client.inventoryReservation.findMany({ where: { orderId: id } })
  }))
}

export async function issueOrder(db, f) {
  const id = await db.market.create(f.buyer, randomUUID(), f.input)
  await db.market.act(f.buyer, randomUUID(), id, 'pay')
  await db.market.act(f.seller, randomUUID(), id, 'deliver', { reference: 'virtual-tracking' })
  await db.market.act(f.buyer, randomUUID(), id, 'issue', { description: 'Virtual issue' })
  await db.market.act(f.buyer, randomUUID(), id, 'request_refund')
  return id
}
