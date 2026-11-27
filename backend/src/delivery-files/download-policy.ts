import { DomainError } from '../common/domain-error.js'

// T05 only establishes checked immutable bytes. T08 must supply the exact
// finalized payment+registration mapping before granting buyer downloads.
export function assertBuyerDownload(): never {
  throw new DomainError('STATE_CONFLICT')
}
