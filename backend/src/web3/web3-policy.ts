import { readChainDeployment } from './chain-config.js'
import { readFileSync } from 'node:fs'
import { DomainError } from '../common/domain-error.js'
import type { EvmAddress, OrderTerms, Web3Config } from './web3-types.js'

export const web3Policy = Object.freeze({
  chainId: 11155111,
  tokenDecimals: 6,
  paymentSeconds: 1800,
  deliverySeconds: 259200,
  acceptanceSeconds: 604800,
  disputeSeconds: 604800,
  challengeSeconds: 300,
  fileBytes: Object.freeze({
    pdf: 20_000_000,
    png: 20_000_000,
    jpeg: 20_000_000,
    zip: 500_000_000
  }),
  zipEntries: 10_000,
  zipExpandedBytes: 2_000_000_000,
  zipEntryBytes: 500_000_000,
  zipRatio: 100,
  checkWallSeconds: 120,
  accountStorageBytes: 2_000_000_000,
  activeUploads: 2,
  uploadsPerRollingHour: 10,
  uploadSeconds: 86400,
  downloadSeconds: 300,
  fileRetentionSeconds: 90 * 86400,
  evidenceRetentionSeconds: 180 * 86400,
  backupRetentionSeconds: 14 * 86400
})

const uint256Max = (1n << 256n) - 1n

export function normalizeWalletAddress(value: unknown): EvmAddress {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/.test(value))
    throw new DomainError('INVALID_INPUT')
  return value.toLowerCase() as EvmAddress
}

export function parseTestPrice(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 85 ||
    !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)
  )
    throw new DomainError('INVALID_AMOUNT')
  const [whole, fraction = ''] = value.split('.')
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
  if (amount <= 0n || amount > uint256Max) throw new DomainError('INVALID_AMOUNT')
  return amount.toString()
}

export function orderTerms(input: OrderTerms): OrderTerms {
  const {
    orderId,
    stockId,
    stockGeneration,
    previousOrderId,
    chainId,
    amountAtoms,
    commitmentHash
  } = input
  for (const hash of [orderId, stockId, previousOrderId, commitmentHash]) {
    if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new DomainError('INVALID_INPUT')
  }
  if (
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    !/^(0|[1-9][0-9]{0,77})$/.test(stockGeneration) ||
    BigInt(stockGeneration) > uint256Max ||
    !/^[1-9][0-9]{0,77}$/.test(amountAtoms) ||
    BigInt(amountAtoms) > uint256Max
  )
    throw new DomainError('INVALID_INPUT')
  const buyer = normalizeWalletAddress(input.buyer)
  const seller = normalizeWalletAddress(input.seller)
  const refundAddress = normalizeWalletAddress(input.refundAddress)
  if (buyer === seller || refundAddress !== buyer) throw new DomainError('INVALID_INPUT')
  return {
    orderId,
    stockId,
    stockGeneration,
    previousOrderId,
    chainId,
    buyer,
    seller,
    refundAddress,
    token: normalizeWalletAddress(input.token),
    escrow: normalizeWalletAddress(input.escrow),
    amountAtoms,
    commitmentHash
  }
}

export function assertOrderTermsMatch(original: OrderTerms, replacement: OrderTerms) {
  try {
    if (JSON.stringify(orderTerms(original)) === JSON.stringify(orderTerms(replacement))) return
  } catch {
    /* Invalid replacement terms are also a state conflict. */
  }
  throw new DomainError('STATE_CONFLICT')
}

export function readWeb3Config(env: NodeJS.ProcessEnv): Web3Config | null {
  if (env.WEB3_ENABLED && !['0', '1'].includes(env.WEB3_ENABLED))
    throw new Error('Invalid WEB3_ENABLED')
  if (env.WEB3_ENABLED !== '1') return null
  const local = env.WEB3_PROFILE === 'local' && env.NODE_ENV === 'test'
  const chainId = Number(env.WEB3_CHAIN_ID ?? web3Policy.chainId)
  if (chainId !== (local ? 31337 : web3Policy.chainId)) throw new Error('Unsupported Web3 chain')
  if (env.WEB3_SECURITY_LEDGER_URL && env.WEB3_SECURITY_LEDGER_URL_FILE)
    throw new Error('Set only one Web3 security ledger URL source')
  const ledger = env.WEB3_SECURITY_LEDGER_URL_FILE
    ? readFileSync(env.WEB3_SECURITY_LEDGER_URL_FILE, 'utf8').trim()
    : env.WEB3_SECURITY_LEDGER_URL
  if (
    !env.WEB3_TOKEN_ADDRESS ||
    !env.WEB3_ESCROW_ADDRESS ||
    !env.WEB3_RPC_PRIMARY ||
    !env.WEB3_RPC_SECONDARY ||
    !ledger
  )
    throw new Error('Incomplete Web3 configuration')
  if (
    !env.WEB3_SECURITY_LEDGER_ID ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      env.WEB3_SECURITY_LEDGER_ID
    )
  )
    throw new Error('Invalid Web3 security ledger identity')
  const endpoint = (value: string) => {
    const url = new URL(value)
    if (
      url.username ||
      url.password ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(
          local &&
          url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        ))
    )
      throw new Error('Invalid Web3 RPC')
    return url
  }
  const primary = endpoint(env.WEB3_RPC_PRIMARY)
  const secondary = endpoint(env.WEB3_RPC_SECONDARY)
  if (primary.host === secondary.host) throw new Error('Web3 RPC sources must be independent')
  const ledgerUrl = new URL(ledger)
  if (
    !['postgres:', 'postgresql:'].includes(ledgerUrl.protocol) ||
    ledgerUrl.pathname === '/' ||
    ledgerUrl.hash
  )
    throw new Error('Invalid Web3 security ledger URL')
  const chainDeployment = readChainDeployment(env.WEB3_CHAIN_DEPLOYMENT_FILE)
  if ((env.WEB3_PAYMENT_SIGNER_FILE || env.WEB3_DELIVERY_SIGNER_FILE) && !chainDeployment)
    throw new Error('Payment signing requires pinned chain deployment')
  return {
    chainId,
    tokenDecimals: 6,
    chainDeployment,
    paymentSignerFile: env.WEB3_PAYMENT_SIGNER_FILE,
    deliverySignerFile: env.WEB3_DELIVERY_SIGNER_FILE,
    token: normalizeWalletAddress(env.WEB3_TOKEN_ADDRESS),
    escrow: normalizeWalletAddress(env.WEB3_ESCROW_ADDRESS),
    rpcPrimary: primary.toString(),
    rpcSecondary: secondary.toString(),
    securityWitnessDirectory: env.WEB3_SECURITY_WITNESS_DIR,
    securityLedgerUrl: ledger,
    securityLedgerId: env.WEB3_SECURITY_LEDGER_ID.toLowerCase()
  }
}
