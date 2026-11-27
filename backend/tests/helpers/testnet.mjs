import { randomUUID } from 'node:crypto'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sandbox, fixture } from './database.mjs'
import { isolatedLedger } from './wallet-ledger.mjs'
import { AuthService } from '../../dist/auth/auth.service.js'
import { WalletAuthService } from '../../dist/auth/wallet-auth.service.js'
import { SellerPayoutService } from '../../dist/web3/seller-payout.service.js'
import { ListingCommands } from '../../dist/listings/listing-commands.js'
import { OrderCommands } from '../../dist/orders/order-commands.js'
import { hashPassword } from '../../dist/auth/password.js'
import { readConfig } from '../../dist/config.js'

const password = 'Virtual-T03-seller-password-only'
export async function testnetFixture(overrides = {}, securityOptions = {}) {
  const db = await sandbox(),
    security = await isolatedLedger(securityOptions),
    f = await fixture(db, 'digital', '10')
  await db.client.digitalInventory.create({ data: { listingId: f.listing.id } })
  await db.client.accountCredential.create({
    data: { accountId: f.seller, passwordHash: await hashPassword(password) }
  })
  const config = {
    chainId: 11155111,
    tokenDecimals: 6,
    token: '0x' + '1'.repeat(40),
    escrow: '0x' + '2'.repeat(40),
    rpcPrimary: 'https://one.invalid',
    rpcSecondary: 'https://two.invalid',
    securityLedgerUrl: db.url.toString(),
    securityLedgerId: security.id,
    ...overrides
  }
  const auth = new AuthService(
    db.client,
    readConfig({ DATABASE_URL: db.url.toString() }),
    security.ledger
  )
  const account = await db.client.account.findUniqueOrThrow({ where: { id: f.seller } })
  const user = await auth.login(account.loginName, password, '127.0.0.1')
  let offset = 0
  const wallets = new WalletAuthService(db.client, auth, security.ledger, {
    ...config,
    appOrigin: 'http://localhost:3000',
    assertEoa: async () => {},
    now: () => new Date(Date.now() + offset)
  })
  const payout = new SellerPayoutService(db.client, wallets, security.ledger, config)
  const listings = new ListingCommands(db.client, config),
    orders = new OrderCommands(db.client, payout)
  const w = privateKeyToAccount(generatePrivateKey())
  const challenge = async (purpose, wallet = w) => {
    const key = randomUUID(),
      proof = await wallets.requestPasswordReauth(
        user,
        password,
        purpose,
        wallet.address,
        key,
        '127.0.0.1'
      )
    return wallets.createActionChallenge(user, proof.id, purpose, wallet.address, key)
  }
  const bind = async (wallet = w) => {
    const c = await challenge('bind', wallet)
    return wallets.consumeActionChallenge(user, c.id, await wallet.signTypedData(c.typedData))
  }
  const confirm = async () => {
    const c = await challenge('payout')
    return payout.confirmSellerPayout(user, c.id, await w.signTypedData(c.typedData))
  }
  const price = async (amount) => {
    const l = await db.client.listing.findUniqueOrThrow({ where: { id: f.listing.id } })
    return listings.edit(f.seller, l.id, l.version, { testnetPriceAmount: amount })
  }
  const create = async (options = {}, version) =>
    orders.create(
      f.buyer,
      randomUUID(),
      {
        listingId: f.listing.id,
        version:
          version ??
          (await db.client.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).version,
        settlementMode: 'testnet_escrow'
      },
      options
    )
  return {
    db,
    security,
    f,
    config,
    auth,
    user,
    wallets,
    payout,
    listings,
    orders,
    w,
    challenge,
    bind,
    confirm,
    price,
    create,
    tick: (ms) => {
      offset += ms
    },
    close: async () => {
      await db.close()
      await security.close()
    }
  }
}
