import test from 'node:test'
import assert from 'node:assert/strict'
import { sandbox } from './helpers/database.mjs'
import { EscrowProjector } from '../dist/web3/escrow-projector.js'
const h = (n) => '0x' + n.toString(16).padStart(64, '0')
const a = (n) => '0x' + n.toString(16).padStart(40, '0')
const config = {
  chainId: 11155111,
  token: a(1),
  escrow: a(2),
  rpcPrimary: 'https://one.invalid',
  rpcSecondary: 'https://two.invalid'
}
const deployment = {
  deploymentBlock: '0',
  escrowCodeHash: h(1),
  tokenCodeHash: h(2),
  administrator: a(3),
  arbitrator: a(4)
}
function range() {
  const order = {
    orderId: h(10),
    state: 'Refunded',
    buyer: a(5),
    refundAddress: a(5),
    seller: a(6),
    amountAtoms: '1000001',
    stockId: h(20),
    generation: '0',
    fundedAt: '100',
    deliveredAt: '101',
    disputedAt: '102',
    credentialId: h(30),
    deliveryVersion: h(31),
    manifestCommitment: h(32),
    termsHash: h(40)
  }
  const event = (name, n, args) => ({
    name,
    args,
    height: String(n),
    blockHash: h(100 + n),
    txHash: h(200 + n),
    txIndex: '0',
    logIndex: '0'
  })
  return {
    from: '0',
    snapshot: {
      chainId: 11155111,
      height: '3',
      hash: h(103),
      timestamp: 103,
      verifiedBy: [config.rpcPrimary, config.rpcSecondary],
      verifiedAt: new Date()
    },
    blocks: [0, 1, 2, 3].map((n) => ({
      height: String(n),
      hash: h(100 + n),
      parentHash: h(99 + n),
      timestamp: 100 + n
    })),
    events: [
      event('Deposited', 0, {
        orderId: h(10),
        intentId: h(50),
        stockId: h(20),
        generation: '0',
        buyer: a(5),
        refundAddress: a(5),
        seller: a(6),
        token: a(1),
        amountAtoms: '1000001',
        timestamp: '100',
        deliveryDeadline: '259300',
        termsHash: h(40)
      }),
      event('DeliveryRegistered', 1, {
        orderId: h(10),
        credentialId: h(30),
        deliveryVersion: h(31),
        manifestCommitment: h(32),
        seller: a(6),
        timestamp: '101',
        acceptanceDeadline: '604901'
      }),
      event('DisputeOpened', 2, {
        orderId: h(10),
        buyer: a(5),
        timestamp: '102',
        disputeDeadline: '604902',
        evidenceCommitment: h(33)
      }),
      event('Refunded', 3, {
        orderId: h(10),
        recipient: a(5),
        token: a(1),
        amountAtoms: '1000001',
        timestamp: '103',
        reason: '4',
        reasonCommitment: h(0)
      })
    ],
    orders: [order],
    stocks: [{ stockId: h(20), occupant: h(10), generation: '0' }],
    globals: {
      outstanding: '0',
      totalDeposited: '1000001',
      totalPaid: '1000001',
      balance: '0',
      paused: false
    }
  }
}
async function withProjector(work) {
  const db = await sandbox()
  try {
    const p = new EscrowProjector(db.client, config, deployment)
    await p.initialize('recovery')
    await work(p, db)
  } finally {
    await db.close()
  }
}
test('A07/A17 complete range publishes only final refund and never grants downloads or releases stock', () =>
  withProjector(async (p, db) => {
    const r = range()
    await p.project(r, {
      checkpoint: async (stage) => {
        if (stage === 'before-commit') {
          assert.equal(await db.read((c) => c.escrowProjection.count()), 0)
          assert.equal(
            (
              await db.read((c) =>
                c.scanCheckpoint.findUniqueOrThrow({ where: { scope: p.scope } })
              )
            ).height,
            -1n
          )
        }
      }
    })
    const projected = await db.client.escrowProjection.findFirstOrThrow()
    assert.equal(projected.state, 'Refunded')
    assert.equal(projected.downloadEnabled, false)
    assert.equal(projected.holdReason, 'PRIVATE_BASIS_MISSING')
    assert.equal(
      (await db.client.chainStockProjection.findFirstOrThrow()).status,
      'blocked_registered'
    )
    assert.equal(
      (await db.client.scanCheckpoint.findUniqueOrThrow({ where: { scope: p.scope } })).height,
      3n
    )
    assert.equal(await db.client.chainEvent.count(), 4)
  }))
test('A07 rollback before commit retains cursor, balances and event dedup; retry applies once', () =>
  withProjector(async (p, db) => {
    const r = range()
    await assert.rejects(
      p.project(r, {
        checkpoint: async (stage) => {
          if (stage === 'before-commit') throw new Error('injected database transaction failure')
        }
      }),
      /injected/
    )
    assert.equal(await db.client.chainEvent.count(), 0)
    assert.equal(await db.client.escrowProjection.count(), 0)
    assert.equal((await db.client.scanCheckpoint.findFirstOrThrow()).height, -1n)
    await p.project(r)
    await p.project(r)
    assert.equal(await db.client.chainEvent.count(), 4)
    assert.equal(await db.client.escrowProjection.count(), 1)
  }))
test('A13 accepted finalized contradiction quarantines without rewriting prior terminal money', () =>
  withProjector(async (p, db) => {
    const r = range()
    await p.project(r)
    const changed = JSON.parse(JSON.stringify(r))
    changed.snapshot.hash = h(999)
    changed.blocks[3].hash = h(999)
    await assert.rejects(p.project(changed), /contradiction/)
    assert.equal((await db.client.scanCheckpoint.findFirstOrThrow()).status, 'isolated')
    assert.equal((await db.client.escrowProjection.findFirstOrThrow()).state, 'Refunded')
    assert.equal(await db.client.reconciliationIncident.count(), 1)
  }))
test('A13 replay cannot reconstruct missing private mappings or unbroadcast issuance from chain absence', () =>
  withProjector(async (p, db) => {
    await p.project(range())
    assert.equal((await db.client.scanCheckpoint.findFirstOrThrow()).status, 'recovering')
    assert.equal(await db.client.paymentIntent.count(), 0)
    assert.equal(await db.client.privateFileVersion.count(), 0)
    assert.equal((await db.client.escrowProjection.findFirstOrThrow()).businessOrderId, null)
    assert.equal((await db.client.escrowProjection.findFirstOrThrow()).downloadEnabled, false)
  }))
test('T07 restricted runtime projects facts but cannot rewrite accepted blocks, deployment pins or enable downloads', async () => {
  const { connect, testUrl } = await import('./helpers/database.mjs')
  const { grantRuntime } = await import('../scripts/runtime-grants.mjs')
  const { randomUUID, randomBytes } = await import('node:crypto')
  const db = await sandbox(),
    admin = await connect(testUrl()),
    role = 't07_role_' + randomUUID().replaceAll('-', ''),
    password = randomBytes(24).toString('hex')
  let runtime,
    created = false
  try {
    await admin.client.$executeRawUnsafe(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
    )
    created = true
    await grantRuntime(admin.client, db.schema, role)
    const url = new URL(db.url)
    url.username = role
    url.password = password
    runtime = await connect(url)
    const p = new EscrowProjector(db.client, config, deployment)
    await p.initialize('recovery')
    await new EscrowProjector(runtime.client, config, deployment).project(range())
    assert.equal(await runtime.client.chainEvent.count(), 4)
    await assert.rejects(
      runtime.client.chainBlock.updateMany({ data: { hash: h(999) } }),
      /permission denied/
    )
    await assert.rejects(
      runtime.client.scanCheckpoint.updateMany({ data: { configHash: 'f'.repeat(64) } }),
      /permission denied/
    )
    await assert.rejects(
      runtime.client.escrowProjection.updateMany({ data: { downloadEnabled: true } }),
      /check constraint/
    )
  } finally {
    if (runtime) await runtime.onModuleDestroy()
    await db.close()
    if (created) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    await admin.onModuleDestroy()
  }
})
for(const part of ['events','state','globals'])test('T07 review: same-H replay rejects a changed complete '+part+' set',()=>withProjector(async(p,db)=>{
 const r=range();await p.project(r)
 const changed=JSON.parse(JSON.stringify(r))
 if(part==='events')changed.events.pop()
 if(part==='state')changed.orders[0].state='Funded'
 if(part==='globals')changed.globals.totalPaid='0'
 await assert.rejects(p.project(changed),e=>e.kind==='contradiction')
 assert.equal((await db.client.scanCheckpoint.findFirstOrThrow()).status,'isolated')
 assert.equal((await db.client.escrowProjection.findFirstOrThrow()).state,'Refunded')
}))
