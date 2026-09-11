import { Prisma } from '../generated/prisma/client.js'
import { DomainError } from './domain-error.js'

// Storage envelope only. C2 will narrow precision/currencies before exposing price DTOs.
// PostgreSQL rounds excess scale before CHECK; validate the original string before writing.
export function parseStoredAmount(value: unknown): Prisma.Decimal {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,19})(\.[0-9]{1,18})?$/.test(value) ||
    !/[1-9]/.test(value)
  ) {
    throw new DomainError('INVALID_AMOUNT')
  }
  return new Prisma.Decimal(value)
}
