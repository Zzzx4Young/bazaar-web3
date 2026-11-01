// Public example statements for disposable test fixtures and V2 preview data.
export function exampleCommitment(type) {
  if (type === 'digital') return {
    schemaVersion: 1, resourceMode: 'file',
    deliverables: [{ name: 'Example resource', format: 'zip', quantity: 1 }],
    sellerUseNotes: 'Use in one project', exclusions: ['No redistribution'],
    noOtherRestrictions: false, sourceTermsUrl: null,
    fulfillmentMethod: 'order_delivery',
    estimatedDeliveryWindow: { min: 1, max: 3, unit: 'days' },
    useTerm: 'One year', seatOrProjectScope: 'One person', updatesIncluded: false,
    sourceFilesIncluded: true, fileFormats: ['zip'], thirdPartyComponents: 'None'
  }
  return {
    schemaVersion: 1, conditionGrade: 'good', knownDefects: 'No known defects',
    includedItems: ['Item shown'], functionalStatus: 'normal',
    functionalNotes: 'No known functional issue', dispatchMethod: 'seller_courier',
    estimatedDispatchWindow: { min: 1, max: 3, unit: 'days' }
  }
}
