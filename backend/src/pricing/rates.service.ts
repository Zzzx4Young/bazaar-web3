import { type PrismaClient, type RateSnapshot } from '../generated/prisma/client.js'
import { DomainError } from '../common/domain-error.js'
import { currencyCodes } from './currencies.js'

export type RateLoader = () => Promise<unknown>

export async function fetchCoinbase(): Promise<unknown> {
  const response = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD', {
    signal: AbortSignal.timeout(3000),
    redirect: 'error',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok || !response.body) throw new Error('Rate provider unavailable')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > 131072) throw new Error('Rate response too large')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } finally {
    await reader.cancel()
  }
}

export class RatesService {
  private pending?: Promise<RateSnapshot>
  constructor(
    private readonly client: PrismaClient,
    private readonly load: RateLoader = fetchCoinbase
  ) {}

  view(quote: RateSnapshot) {
    return {
      id: quote.id,
      base: 'USD',
      provider: quote.provider,
      fetchedAt: quote.fetchedAt,
      expiresAt: quote.expiresAt,
      sourceAsOf: null
    }
  }

  async quote(id?: string) {
    if (id) {
      const found = await this.client.rateSnapshot.findUnique({ where: { id } })
      if (!found || found.expiresAt <= new Date()) throw new DomainError('FX_SNAPSHOT_EXPIRED')
      return found
    }
    const found = await this.client.rateSnapshot.findFirst({
      where: { expiresAt: { gt: new Date() } },
      orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }]
    })
    if (found) return found
    if (!this.pending)
      this.pending = this.refresh().finally(() => {
        this.pending = undefined
      })
    return this.pending
  }

  private async refresh() {
    try {
      const input = await this.load()
      if (!input || typeof input !== 'object' || !('data' in input)) throw new Error()
      const data = input.data as { currency?: unknown; rates?: unknown }
      if (
        !data ||
        data.currency !== 'USD' ||
        !data.rates ||
        typeof data.rates !== 'object' ||
        Array.isArray(data.rates)
      )
        throw new Error()
      const source = data.rates as Record<string, unknown>
      const raw: Record<string, string> = {}
      for (const code of currencyCodes) {
        const value = source[code]
        if (
          typeof value !== 'string' ||
          value.length > 100 ||
          !/^(0|[1-9][0-9]{0,29})(\.[0-9]{1,60})?$/.test(value) ||
          !/[1-9]/.test(value)
        )
          throw new Error()
        raw[code] = value
      }
      if (!/^1(?:\.0+)?$/.test(raw.USD)) throw new Error()
      // PostgreSQL numeric performs the reciprocal with 60 fractional digits before
      // storing 40-digit factors; no money or rate arithmetic passes through JS Number.
      const rows = await this.client.$queryRaw<{ code: string; factor: string }[]>`
        SELECT key AS code, ((1::numeric(80,60) / value::numeric)::numeric(80,40))::text AS factor
        FROM jsonb_each_text(${JSON.stringify(raw)}::jsonb)`
      const rates: Record<string, string> = Object.fromEntries(
        rows.map((row) => [row.code, row.factor])
      )
      rates.USD = '1'
      if (Object.values(rates).some((value) => !/[1-9]/.test(value))) throw new Error()
      const fetchedAt = new Date()
      return await this.client.rateSnapshot.create({
        data: {
          provider: 'Coinbase',
          rates,
          fetchedAt,
          expiresAt: new Date(fetchedAt.getTime() + 60 * 60 * 1000)
        }
      })
    } catch {
      throw new DomainError('FX_UNAVAILABLE')
    }
  }
}
