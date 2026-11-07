import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { connect, testUrl } from './helpers/database.mjs'
import { grantWalletLedger } from '../scripts/wallet-ledger-grants.mjs'
import { assertWalletLedgerGrants } from '../dist/auth/wallet-ledger-grants.js'
import { PostgresWalletSecurityLedger } from '../dist/auth/postgres-wallet-security-ledger.js'

test('A27/A30: ledger runtime cannot rewrite metadata or remove permanent claims; business role cannot read ledger', async () => {
  const ledger = await isolatedLedger(), admin = await connect(testUrl())
  const roles = [], connections = []
  try {
    const [{ schema }] = await ledger.client.$queryRaw`SELECT current_schema() AS schema`
    const urls = []
    for (const prefix of ['wl_run_', 'wl_biz_']) {
      const role = prefix + randomUUID().replaceAll('-', ''), password = randomBytes(24).toString('hex')
      await admin.client.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`)
      roles.push(role)
      const url = new URL(testUrl())
      url.username = role
      url.password = password
      url.searchParams.set('schema', schema)
      urls.push(url)
    }
    await grantWalletLedger(ledger.client, schema, roles[0])
    const runtime = await connect(urls[0]), business = await connect(urls[1])
    connections.push(runtime, business)
    await assertWalletLedgerGrants(runtime.client)
    await assert.rejects(assertWalletLedgerGrants(ledger.client), /privileges/)
    const restricted = new PostgresWalletSecurityLedger(runtime.client, ledger.id)
    const op = { operationId: randomUUID(), accountId: randomUUID(), chainId: 11155111, operation: 'bind',
      address: '0x' + '3'.repeat(40), expectedRecoveryEpoch: ledger.epoch, expectedRevision: '0', expectedBindingVersion: 0, payout: null, requestHash: 'a'.repeat(64) }
    await restricted.prepare(op)
    await restricted.commit(op.operationId)
    await assert.rejects(runtime.client.$executeRaw`DELETE FROM "WalletLedgerClaim"`, /permission denied/)
    await assert.rejects(runtime.client.$executeRaw`UPDATE "WalletLedgerMeta" SET "maintenance" = true`, /permission denied/)
    await assert.rejects(business.client.$queryRawUnsafe(`SELECT * FROM "${schema}"."WalletLedgerClaim"`), /permission denied/)
  } finally {
    for (const c of connections) await c.onModuleDestroy()
    await ledger.close()
    for (const role of roles) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    await admin.onModuleDestroy()
  }
})

test('wallet bind, unbind and rebind work with both restricted runtime roles', async () => {
  const { sandbox, fixture } = await import('./helpers/database.mjs')
  const { grantRuntime } = await import('../scripts/runtime-grants.mjs')
  const { AuthService } = await import('../dist/auth/auth.service.js')
  const { WalletAuthService } = await import('../dist/auth/wallet-auth.service.js')
  const { hashPassword } = await import('../dist/auth/password.js')
  const { readConfig } = await import('../dist/config.js')
  const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts')
  const db = await sandbox(), ledger = await isolatedLedger(), admin = await connect(testUrl())
  const roles = [], connections = []
  try {
    const [{ schema }] = await ledger.client.$queryRaw`SELECT current_schema() AS schema`
    for (const prefix of ['wlr_', 'wbr_']) {
      const role = prefix + randomUUID().replaceAll('-', ''), password = randomBytes(24).toString('hex')
      await admin.client.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`)
      roles.push(role)
      const url = new URL(prefix === 'wlr_' ? testUrl() : db.url)
      url.username = role
      url.password = password
      url.searchParams.set('schema', prefix === 'wlr_' ? schema : db.schema)
      if (prefix === 'wlr_') await grantWalletLedger(ledger.client, schema, role)
      else await grantRuntime(db.client, db.schema, role)
      connections.push(await connect(url))
    }
    const f = await fixture(db, 'digital'), password = 'Virtual-restricted-wallet-password'
    await db.client.accountCredential.create({ data: { accountId: f.buyer, passwordHash: await hashPassword(password) } })
    const restrictedLedger = new PostgresWalletSecurityLedger(connections[0].client, ledger.id)
    const auth = new AuthService(connections[1].client, readConfig({ DATABASE_URL: db.url.toString() }), restrictedLedger)
    const account = await db.client.account.findUniqueOrThrow({ where: { id: f.buyer } })
    const user = await auth.login(account.loginName, password, '127.0.0.1')
    const service = new WalletAuthService(connections[1].client, auth, restrictedLedger, { chainId: 11155111,
      escrow: '0x' + '7'.repeat(40), appOrigin: 'http://localhost:3000', assertEoa: async () => {} })
    const w = privateKeyToAccount(generatePrivateKey())
    for (const purpose of ['bind', 'unbind', 'bind']) {
      const key = randomUUID()
      const proof = await service.requestPasswordReauth(user, password, purpose, w.address, key, '127.0.0.1')
      const c = await service.createActionChallenge(user, proof.id, purpose, w.address, key)
      await service.consumeActionChallenge(user, c.id, purpose === 'bind' ? await w.signTypedData(c.typedData) : undefined)
    }
    assert.equal((await service.current(user)).bindingVersion, 3)
    assert.equal(await db.client.walletClaim.count(), 1)
    // T03: the same restricted roles can confirm payouts and append immutable terms.
    const config = { chainId: 11155111, tokenDecimals: 6, token: '0x' + '8'.repeat(40),
      escrow: '0x' + '7'.repeat(40), rpcPrimary: 'https://one.invalid', rpcSecondary: 'https://two.invalid',
      securityLedgerUrl: db.url.toString(), securityLedgerId: ledger.id }
    const { SellerPayoutService } = await import('../dist/web3/seller-payout.service.js')
    const { ListingCommands } = await import('../dist/listings/listing-commands.js')
    const { OrderCommands } = await import('../dist/orders/order-commands.js')
    const key = randomUUID(), proof = await service.requestPasswordReauth(user, password, 'payout', w.address, key, '127.0.0.1')
    const c = await service.createActionChallenge(user, proof.id, 'payout', w.address, key)
    const payout = new SellerPayoutService(connections[1].client, service, restrictedLedger, config)
    await payout.confirmSellerPayout(user, c.id, await w.signTypedData(c.typedData))
    const listing = await db.client.listing.create({ data: { sellerId: user.account.id, type: 'digital',
      saleMode: 'one_off', title: 'Runtime file', description: 'Virtual file only', category: 'digital_assets',
      priceAmount: '1', currency: 'CNY', licenseDescription: 'Test license', contentVersion: 'v1',
      commitment: f.listing.commitment, commitmentVersion: 1 } })
    await db.client.digitalInventory.create({ data: { listingId: listing.id } })
    await new ListingCommands(connections[1].client, config).edit(user.account.id, listing.id, 1, { testnetPriceAmount: '2' })
    const id = await new OrderCommands(connections[1].client, payout).create(f.other, randomUUID(), {
      listingId: listing.id, version: 2, settlementMode: 'testnet_escrow' })
    assert.equal((await payout.existingOrderTerms(f.other, id)).amountAtoms, '2000000')
    await assert.rejects(connections[1].client.testnetOrderSnapshot.update({ where: { orderId: id },
      data: { amountAtoms: '3000000' } }), /permission denied/)
    const price = await db.client.listingTestnetPrice.findFirstOrThrow({ where: { listingId: listing.id } })
    await assert.rejects(connections[1].client.listingTestnetPrice.update({ where: { id: price.id },
      data: { amountAtoms: '3000000' } }), /permission denied/)
  } finally {
    for (const connection of connections) await connection.onModuleDestroy()
    await db.close()
    await ledger.close()
    for (const role of roles) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    await admin.onModuleDestroy()
  }
})
