import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeWalletAddress, parseTestPrice, readWeb3Config, web3Policy,
  orderTerms, assertOrderTermsMatch } from '../dist/web3/web3-policy.js'
import { DomainError, mapApplicationError } from '../dist/common/domain-error.js'

const address = '0x1234567890abcdef1234567890abcdef12345678'

test('A27: an untrusted wallet recovery watermark fails closed as retryable service unavailable', () => {
  assert.deepEqual(mapApplicationError(new DomainError('WALLET_UNAVAILABLE')),
    { status: 503, code: 'WALLET_UNAVAILABLE', retryable: true })
})

test('A29: BZTEST prices use integer atoms and never round excess precision', () => {
  assert.equal(parseTestPrice('0.000001'), '1')
  assert.equal(parseTestPrice('12345678901234567890.123456'), '12345678901234567890123456')
  assert.equal(parseTestPrice('1.000000'), '1000000')
  for (const value of ['0', '-1', '1.0000001', '1e6', 'NaN', ' 1', '1 ', '+1', '01', '.1', '1.', 1]) {
    assert.throws(() => parseTestPrice(value), /INVALID_AMOUNT/)
  }
  assert.throws(() => parseTestPrice('9'.repeat(80)), /INVALID_AMOUNT/)
})

test('A30: normalized addresses cannot acquire a second identity through letter case', () => {
  assert.equal(normalizeWalletAddress(address.toUpperCase().replace('0X', '0x')), address)
  for (const value of ['0x' + '0'.repeat(40), '0x123', address + '00', ' ' + address, null]) {
    assert.throws(() => normalizeWalletAddress(value), /INVALID_INPUT/)
  }
})

test('A18: Web3 is off by default; enabled Sepolia cannot silently use mainnet or incomplete configuration', () => {
  assert.equal(readWeb3Config({}), null)
  assert.throws(() => readWeb3Config({ WEB3_ENABLED: 'yes' }), /WEB3_ENABLED/)
  assert.throws(() => readWeb3Config({ WEB3_ENABLED: '1', WEB3_CHAIN_ID: '1' }), /chain/)
  assert.throws(() => readWeb3Config({ WEB3_ENABLED: '1', WEB3_CHAIN_ID: '11155111' }), /Incomplete/)
  const config = readWeb3Config({ WEB3_ENABLED: '1', WEB3_CHAIN_ID: '11155111',
    WEB3_TOKEN_ADDRESS: address, WEB3_ESCROW_ADDRESS: '0x' + '2'.repeat(40),
    WEB3_RPC_PRIMARY: 'https://rpc-a.invalid', WEB3_RPC_SECONDARY: 'https://rpc-b.invalid',
    WEB3_SECURITY_LEDGER_URL: 'postgresql://ledger@127.0.0.1:55435/wallet_security' })
  assert.equal(config.chainId, 11155111)
  assert.equal(config.tokenDecimals, 6)
  assert.throws(() => readWeb3Config({ WEB3_ENABLED: '1', WEB3_CHAIN_ID: '11155111',
    WEB3_TOKEN_ADDRESS: address, WEB3_ESCROW_ADDRESS: '0x' + '2'.repeat(40),
    WEB3_RPC_PRIMARY: 'https://same.invalid/a', WEB3_RPC_SECONDARY: 'https://same.invalid/b',
    WEB3_SECURITY_LEDGER_URL: 'postgresql://ledger@127.0.0.1:55435/wallet_security' }), /independent/)
})

test('A04/A20: replacement intents cannot change the immutable order tuple', () => {
  const terms = { orderId: '0x' + '1'.repeat(64), stockId: '0x' + '2'.repeat(64),
    stockGeneration: '0', previousOrderId: '0x' + '0'.repeat(64), chainId: 11155111,
    buyer: address, seller: '0x' + '3'.repeat(40), refundAddress: address,
    token: '0x' + '4'.repeat(40), escrow: '0x' + '5'.repeat(40),
    amountAtoms: '1000000', commitmentHash: '0x' + '6'.repeat(64) }
  assert.deepEqual(orderTerms(terms), terms)
  assert.doesNotThrow(() => assertOrderTermsMatch(terms, { ...terms }))
  for (const [field, value] of [['buyer', terms.seller], ['seller', address],
    ['amountAtoms', '2000000'], ['stockId', terms.orderId], ['stockGeneration', '1']]) {
    assert.throws(() => assertOrderTermsMatch(terms, { ...terms, [field]: value }), /STATE_CONFLICT/)
  }
})

test('A03/A23/A24: approved deadlines and decimal byte limits have one source', () => {
  assert.equal(web3Policy.paymentSeconds, 1800)
  assert.equal(web3Policy.deliverySeconds, 259200)
  assert.equal(web3Policy.acceptanceSeconds, 604800)
  assert.equal(web3Policy.disputeSeconds, 604800)
  assert.equal(web3Policy.challengeSeconds, 300)
  assert.equal(web3Policy.fileBytes.pdf, 20_000_000)
  assert.equal(web3Policy.fileBytes.zip, 500_000_000)
  assert.equal(web3Policy.zipExpandedBytes, 2_000_000_000)
  assert.equal(web3Policy.accountStorageBytes, 2_000_000_000)
})
