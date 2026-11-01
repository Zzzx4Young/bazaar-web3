import { DomainError } from '../common/domain-error.js'
import { isIP } from 'node:net'

export const commitmentVersion = 1

type RecordValue = Record<string, unknown>
const invalid = (): never => { throw new DomainError('INVALID_INPUT') }
const record = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : invalid()
const string = (value: unknown, max = 2000) =>
  typeof value === 'string' && value.trim().length > 0 && [...value].length <= max
    ? value.trim() : invalid()
const choice = (value: unknown, values: readonly string[]) =>
  typeof value === 'string' && values.includes(value) ? value : invalid()
const strings = (value: unknown, max = 12) =>
  Array.isArray(value) && value.length > 0 && value.length <= max
    ? value.map((entry) => string(entry, 200)) : invalid()
export function publicSourceUrl(value: unknown) {
  const url = string(value, 500)
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      !parsed.hostname.includes('.') || isIP(parsed.hostname) !== 0 ||
      /(?:^|\.)localhost$|\.(?:local|internal|test)$/.test(parsed.hostname)) invalid()
  } catch { invalid() }
  return url
}
const window = (value: unknown) => {
  const input = record(value)
  const min = input.min, max = input.max
  if (!Number.isInteger(min) || !Number.isInteger(max) ||
    (min as number) < 1 || (max as number) < (min as number) || (max as number) > 365)
    invalid()
  return { min: min as number, max: max as number,
    unit: choice(input.unit, ['hours', 'days']) }
}

export function parseCommitment(type: string, value: unknown, mediaCount: number) {
  const input = record(value)
  const common = { schemaVersion: commitmentVersion }
  if (type === 'digital') {
    const resourceMode = choice(input.resourceMode, ['file', 'access'])
    if (!Array.isArray(input.deliverables) || input.deliverables.length < 1 ||
      input.deliverables.length > 12) invalid()
    const deliverables = (input.deliverables as unknown[]).map((entry: unknown) => {
      const item = record(entry)
      const quantity = item.quantity
      if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 999)
        invalid()
      return { name: string(item.name, 200), format: string(item.format, 100),
        quantity: quantity as number }
    })
    const exclusions = input.noOtherRestrictions === true ? [] : strings(input.exclusions)
    if (input.noOtherRestrictions === true &&
      Array.isArray(input.exclusions) && input.exclusions.length) invalid()
    let sourceTermsUrl: string | null = null
    if (input.sourceTermsUrl != null && input.sourceTermsUrl !== '') {
      sourceTermsUrl = publicSourceUrl(input.sourceTermsUrl)
    }
    const shared = { ...common, resourceMode, deliverables,
      sellerUseNotes: string(input.sellerUseNotes), exclusions,
      noOtherRestrictions: input.noOtherRestrictions === true, sourceTermsUrl,
      fulfillmentMethod: choice(input.fulfillmentMethod, ['order_delivery']),
      estimatedDeliveryWindow: window(input.estimatedDeliveryWindow) }
    if (resourceMode === 'access') {
      const duration = input.accessDurationValue
      if (!Number.isInteger(duration) || (duration as number) < 1 ||
        (duration as number) > 1200) invalid()
      return { ...shared, accessDurationValue: duration as number,
        accessDurationUnit: choice(input.accessDurationUnit, ['days', 'months']),
        accessTermNotes: string(input.accessTermNotes),
        expiryBehavior: string(input.expiryBehavior) }
    }
    if (typeof input.updatesIncluded !== 'boolean' ||
      typeof input.sourceFilesIncluded !== 'boolean') invalid()
    return { ...shared, useTerm: string(input.useTerm, 300),
      seatOrProjectScope: string(input.seatOrProjectScope, 300),
      updatesIncluded: input.updatesIncluded as boolean,
      sourceFilesIncluded: input.sourceFilesIncluded as boolean,
      fileFormats: strings(input.fileFormats),
      thirdPartyComponents: string(input.thirdPartyComponents, 1000) }
  }
  if (type !== 'physical' || mediaCount < 1) invalid()
  const functionalStatus = choice(input.functionalStatus,
    ['normal', 'partially_faulty', 'not_working', 'untested', 'not_applicable'])
  return { ...common, conditionGrade: choice(input.conditionGrade,
    ['like_new', 'good', 'fair', 'worn']), knownDefects: string(input.knownDefects),
    includedItems: strings(input.includedItems), functionalStatus,
    functionalNotes: string(input.functionalNotes),
    dispatchMethod: choice(input.dispatchMethod, ['seller_courier']),
    estimatedDispatchWindow: window(input.estimatedDispatchWindow) }
}

export function canPurchaseCommitment(listing: {
  commitment: unknown; commitmentVersion: number | null; reviewStatus: string
}) {
  return listing.reviewStatus === 'clear' &&
    listing.commitmentVersion === commitmentVersion && listing.commitment != null
}
