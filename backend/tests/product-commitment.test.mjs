import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCommitment, canPurchaseCommitment, publicSourceUrl } from '../dist/listings/product-commitment.js'
import { hasExcludedRightsClaim } from '../dist/listings/prohibited-claims.js'

const window = { min: 1, max: 3, unit: 'days' }
const digital = {
  resourceMode: 'file', deliverables: [{ name: 'Templates', format: 'zip', quantity: 1 }],
  sellerUseNotes: 'Use in one personal project', exclusions: ['No redistribution'],
  fulfillmentMethod: 'order_delivery', estimatedDeliveryWindow: window,
  useTerm: 'One year', seatOrProjectScope: 'One person', updatesIncluded: false,
  sourceFilesIncluded: true, fileFormats: ['zip'], thirdPartyComponents: 'None'
}
test('file commitment is accepted and missing restrictions are rejected', () => {
  assert.equal(parseCommitment('digital', digital, 1).resourceMode, 'file')
  assert.throws(() => parseCommitment('digital', { ...digital, exclusions: [] }, 1))
})
test('access commitment needs a positive duration and expiry behavior', () => {
  const access = { ...digital, resourceMode: 'access', accessDurationValue: 30,
    accessDurationUnit: 'days', accessTermNotes: 'Starts at buyer acceptance',
    expiryBehavior: 'No reading after expiry' }
  assert.equal(parseCommitment('digital', access, 1).accessDurationValue, 30)
  assert.throws(() => parseCommitment('digital', { ...access, accessDurationValue: 0 }, 1))
})
test('legacy and suspended listings cannot be purchased', () => {
  assert.equal(canPurchaseCommitment({ commitment: null, commitmentVersion: null,
    reviewStatus: 'clear' }), false)
  assert.equal(canPurchaseCommitment({ commitment: digital, commitmentVersion: 1,
    reviewStatus: 'paused' }), false)
})
test('seller source links reject local and credential bearing hosts', () => {
  assert.equal(publicSourceUrl('https://example.com/source'), 'https://example.com/source')
  assert.throws(() => publicSourceUrl('https://127.0.0.1/private'))
  assert.throws(() => publicSourceUrl('https://user:secret@example.com/source'))
})
test('excluded ownership claims are distinguished from ordinary source file delivery', () => {
  assert.equal(hasExcludedRightsClaim('版权转让后独家持有'), true)
  assert.equal(hasExcludedRightsClaim('交付可编辑源文件'), false)
})
test('physical commitment requires actual media and an explicit defect statement', () => {
  const physical = { conditionGrade: 'good', knownDefects: 'No known defects',
    includedItems: ['Device'], functionalStatus: 'normal',
    functionalNotes: 'No known issue', dispatchMethod: 'seller_courier',
    estimatedDispatchWindow: window }
  assert.equal(parseCommitment('physical', physical, 1).conditionGrade, 'good')
  assert.throws(() => parseCommitment('physical', physical, 0))
  assert.throws(() => parseCommitment('physical', { ...physical, knownDefects: '' }, 1))
})
