import { DomainError } from '../common/domain-error.js'
import { parseStoredAmount } from '../common/money.js'

export const scales = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  CNY: 2,
  CAD: 2,
  AUD: 2,
  CHF: 2,
  HKD: 2,
  SGD: 2,
  KRW: 0,
  INR: 2,
  AED: 2,
  BRL: 2,
  BTC: 8,
  ETH: 18,
  USDT: 6,
  USDC: 6,
  SOL: 9
} as const
export type Currency = keyof typeof scales
export const currencyCodes = Object.keys(scales) as Currency[]

export function currencyInput(value: unknown): Currency {
  if (typeof value !== 'string' || !Object.hasOwn(scales, value))
    throw new DomainError('INVALID_INPUT')
  return value as Currency
}

export function priceInput(value: unknown, currency: Currency) {
  const amount = parseStoredAmount(value)
  if (typeof value !== 'string' || (value.split('.')[1]?.length ?? 0) > scales[currency])
    throw new DomainError('INVALID_AMOUNT')
  return amount
}
