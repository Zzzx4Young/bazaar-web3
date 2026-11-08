import type { Transaction } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import type { Web3Config } from './web3-types.js'
import { chainScope, deploymentDigest, lockChain } from './escrow-projector.js'
export async function assertChainGate(tx: Transaction, config: Web3Config, signing = false) {
  if (!config.chainDeployment) return
  const scope = chainScope(config)
  await lockChain(tx, scope)
  const cursor = await tx.scanCheckpoint.findUnique({ where: { scope } })
  if (
    !cursor ||
    cursor.configHash !== deploymentDigest(config, config.chainDeployment) ||
    cursor.status !== 'active' ||
    cursor.height < cursor.deploymentBlock ||
    !cursor.globals ||
    Date.now() - cursor.updatedAt.getTime() > 30_000 ||
    Date.now() - cursor.updatedAt.getTime() < -5_000 ||
    (signing && (cursor.globals as { paused?: boolean }).paused !== false)
  )
    throw new DomainError('WALLET_UNAVAILABLE')
}
