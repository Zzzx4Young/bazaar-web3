export class DomainError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export interface ErrorResult {
  status: number
  code: string
  retryable: boolean
}

// Only allowlisted domain codes cross the API boundary; never expose driver messages or SQL.
export function mapApplicationError(error: unknown): ErrorResult {
  if (error instanceof DomainError) {
    if (error.code === 'RETRY_EXHAUSTED') return { status: 503, code: error.code, retryable: true }
    if (error.code === 'FORBIDDEN') return { status: 403, code: error.code, retryable: false }
    if (error.code === 'NOT_FOUND') return { status: 404, code: error.code, retryable: false }
    if (
      [
        'INVALID_INPUT',
        'INVALID_AMOUNT',
        'SHIPPING_REQUIRED',
        'DELIVERY_REQUIRED',
        'DESCRIPTION_REQUIRED',
        'RETURN_REQUIRED'
      ].includes(error.code)
    ) {
      return { status: 400, code: error.code, retryable: false }
    }
    if (
      [
        'IDEMPOTENCY_CONFLICT',
        'LISTING_CONFLICT',
        'UNAVAILABLE',
        'INVENTORY_CONFLICT',
        'STATE_CONFLICT',
        'REFUND_REQUIRED',
        'RESTORE_CONFLICT'
      ].includes(error.code)
    ) {
      return { status: 409, code: error.code, retryable: false }
    }
  }
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['P2002', 'P2003'].includes(String(error.code))
  ) {
    return { status: 409, code: 'CONFLICT', retryable: false }
  }
  return { status: 500, code: 'INTERNAL_ERROR', retryable: false }
}
