export type DeliveryWindow = { min: number; max: number; unit: 'hours' | 'days' }
export type Deliverable = { name: string; format: string; quantity: number }
export type DigitalCommitment = {
  schemaVersion: 1
  resourceMode: 'file' | 'access'
  deliverables: Deliverable[]
  sellerUseNotes: string
  exclusions: string[]
  noOtherRestrictions: boolean
  sourceTermsUrl: string | null
  fulfillmentMethod: 'order_delivery'
  estimatedDeliveryWindow: DeliveryWindow
  useTerm?: string
  seatOrProjectScope?: string
  updatesIncluded?: boolean
  sourceFilesIncluded?: boolean
  fileFormats?: string[]
  thirdPartyComponents?: string
  accessDurationValue?: number
  accessDurationUnit?: 'days' | 'months'
  accessTermNotes?: string
  expiryBehavior?: string
}
export type PhysicalCommitment = {
  schemaVersion: 1
  conditionGrade: 'like_new' | 'good' | 'fair' | 'worn'
  knownDefects: string
  includedItems: string[]
  functionalStatus: 'normal' | 'partially_faulty' | 'not_working' | 'untested' | 'not_applicable'
  functionalNotes: string
  dispatchMethod: 'seller_courier'
  estimatedDispatchWindow: DeliveryWindow
}
export type ProductCommitment = DigitalCommitment | PhysicalCommitment

export const initialDigitalCommitment: DigitalCommitment = {
  schemaVersion: 1, resourceMode: 'file',
  deliverables: [{ name: '', format: '', quantity: 1 }],
  sellerUseNotes: '', exclusions: [], noOtherRestrictions: false, sourceTermsUrl: null,
  fulfillmentMethod: 'order_delivery', estimatedDeliveryWindow: { min: 1, max: 3, unit: 'days' },
  useTerm: '', seatOrProjectScope: '', updatesIncluded: false,
  sourceFilesIncluded: false, fileFormats: [], thirdPartyComponents: ''
}
export const initialPhysicalCommitment: PhysicalCommitment = {
  schemaVersion: 1, conditionGrade: 'good', knownDefects: '', includedItems: [],
  functionalStatus: 'normal', functionalNotes: '', dispatchMethod: 'seller_courier',
  estimatedDispatchWindow: { min: 1, max: 3, unit: 'days' }
}

export function commitmentReady(commitment: ProductCommitment): boolean {
  const window = 'resourceMode' in commitment
    ? commitment.estimatedDeliveryWindow : commitment.estimatedDispatchWindow
  if (!Number.isInteger(window.min) || !Number.isInteger(window.max) ||
    window.min < 1 || window.max < window.min || window.max > 365) return false
  if ('resourceMode' in commitment) {
    if (!commitment.deliverables.length || commitment.deliverables.some((item) =>
      !item.name.trim() || !item.format.trim() || !Number.isInteger(item.quantity) ||
      item.quantity < 1)) return false
    if (!commitment.sellerUseNotes.trim() ||
      (!commitment.noOtherRestrictions && !commitment.exclusions.length)) return false
    if (commitment.sourceTermsUrl) {
      try { if (new URL(commitment.sourceTermsUrl).protocol !== 'https:') return false }
      catch { return false }
    }
    if (commitment.resourceMode === 'access') return !!(
      commitment.accessDurationValue && commitment.accessDurationValue > 0 &&
      commitment.accessTermNotes?.trim() && commitment.expiryBehavior?.trim())
    return !!(commitment.useTerm?.trim() && commitment.seatOrProjectScope?.trim() &&
      commitment.fileFormats?.length && commitment.thirdPartyComponents?.trim())
  }
  return !!(commitment.knownDefects.trim() && commitment.includedItems.length &&
    commitment.functionalNotes.trim())
}

