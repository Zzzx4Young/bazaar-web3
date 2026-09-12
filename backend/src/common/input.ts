import { DomainError } from './domain-error.js'

export function objectInput(
  value: unknown,
  keys: string[],
  required: string[] = keys
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    required.some((key) => !(key in value))
  )
    throw new DomainError('INVALID_INPUT')
  return value as Record<string, unknown>
}

export function textInput(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max)
    throw new DomainError('INVALID_INPUT')
  return value.trim()
}

export function idInput(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    throw new DomainError('INVALID_INPUT')
  return value
}

export function positiveInteger(value: unknown, max = 2147483647) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)
    throw new DomainError('INVALID_INPUT')
  return value
}
