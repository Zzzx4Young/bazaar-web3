import { DomainError } from '../common/domain-error.js'

export const idempotencyKeyPolicy = Object.freeze({
  minLength: 1,
  maxLength: 100,
  allowedCharacters: '^[A-Za-z0-9_-]+$'
})

const characters = new RegExp(idempotencyKeyPolicy.allowedCharacters)

export function idempotencyKey(value: unknown): string {
  if (typeof value !== 'string' ||
    value.length < idempotencyKeyPolicy.minLength ||
    value.length > idempotencyKeyPolicy.maxLength ||
    characters.exec(value)?.[0] !== value)
    throw new DomainError('INVALID_INPUT')
  return value
}
