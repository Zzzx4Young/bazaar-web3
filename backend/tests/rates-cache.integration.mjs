import assert from 'node:assert/strict'
import test from 'node:test'
import { currencyCodes } from '../dist/pricing/currencies.js'
import { RatesService } from '../dist/pricing/rates.service.js'
import { rateSnapshotTtlMs } from '../dist/pricing/rates-policy.js'
import { sandbox } from './helpers/database.mjs'

// Explicit provider fixtures test persistence/cache behavior, not live Coinbase availability.
const fixture = () => ({ data: { currency: 'USD',
  rates: Object.fromEntries(currencyCodes.map(code => [code, code === 'EUR' ? '0.8' : '1'])) } })

test('concurrent quotes share one refresh and another service reuses the persisted snapshot', async () => {
  const db = await sandbox()
  try {
    let loads = 0
    const first = new RatesService(db.client, async () => { loads++; return fixture() })
    const quotes = await Promise.all(Array.from({ length: 50 }, () => first.quote()))
    assert.equal(loads, 1)
    assert.equal(new Set(quotes.map(quote => quote.id)).size, 1)
    assert.equal(await db.client.rateSnapshot.count(), 1)
    const quote = quotes[0]
    assert.equal(quote.expiresAt.getTime() - quote.fetchedAt.getTime(), rateSnapshotTtlMs)
    assert.equal(quote.rates.EUR, '1.2500000000000000000000000000000000000000')
    const second = new RatesService(db.client, async () => {
      throw new Error('Cached quote must not call the provider')
    })
    assert.equal((await second.quote()).id, quote.id)
    assert.equal((await second.quote(quote.id)).id, quote.id)
  } finally {
    await db.close()
  }
})

test('provider failure publishes no fallback and concurrent retry can recover', async () => {
  const db = await sandbox()
  try {
    let available = false, loads = 0
    const service = new RatesService(db.client, async () => {
      loads++
      if (!available) throw new Error('Isolated fixture provider outage')
      return fixture()
    })
    const failed = await Promise.allSettled(Array.from({ length: 50 }, () => service.quote()))
    assert.ok(failed.every(result => result.status === 'rejected' && result.reason.code === 'FX_UNAVAILABLE'))
    const failedLoads = loads
    assert.ok(failedLoads >= 1)
    assert.equal(await db.client.rateSnapshot.count(), 0)
    available = true
    const recovered = await Promise.all(Array.from({ length: 50 }, () => service.quote()))
    assert.equal(loads, failedLoads + 1)
    assert.equal(new Set(recovered.map(quote => quote.id)).size, 1)
    assert.equal(await db.client.rateSnapshot.count(), 1)
    const expired = await db.client.rateSnapshot.create({ data: {
      provider: 'Explicit expired test fixture', rates: recovered[0].rates,
      fetchedAt: new Date(Date.now() - 2 * rateSnapshotTtlMs),
      expiresAt: new Date(Date.now() - rateSnapshotTtlMs)
    } })
    await assert.rejects(service.quote(expired.id), error => error.code === 'FX_SNAPSHOT_EXPIRED')
    assert.equal(loads, failedLoads + 1, 'Expired explicit quote must not silently change the requested snapshot')
    const fresh = await service.quote()
    assert.equal(fresh.id, recovered[0].id)
    assert.equal(loads, failedLoads + 1)
  } finally {
    await db.close()
  }
})
