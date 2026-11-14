import type { PrismaClient } from '../generated/prisma/client.js'
import type { AppConfig } from '../config.js'
export function assertControlledRecoveryConfig(
  config: Pick<AppConfig, 'web3' | 'privateLifecycle'>,
  required = false
) {
  if (!required && !config.web3?.controlledRecovery) return
  const wallet = config.web3?.securityCheckpoint,
    files = config.privateLifecycle?.checkpoint
  if (
    !wallet?.historyFile ||
    !files?.historyFile ||
    !wallet.configurationFile ||
    !files.configurationFile ||
    wallet.pairedPrivateConfigurationFile !== files.configurationFile ||
    wallet.environmentId !== files.environmentId ||
    wallet.publicKeyFile !== files.publicKeyFile
  )
    throw new Error('CONTROLLED_CHECKPOINT_CONFIG_REQUIRED')
}

export async function assertStoredRecoveryProfile(
  client: PrismaClient,
  config: Pick<AppConfig, 'web3' | 'privateLifecycle'>
) {
  const [relation] = await client.$queryRaw<
    { present: boolean }[]
  >`SELECT to_regclass(format('%I.%I',current_schema(),'PrivateRecoveryState')) IS NOT NULL AS present`
  if (!relation?.present) {
    if (config.web3?.controlledRecovery) throw new Error('CONTROLLED_RECOVERY_MIGRATION_REQUIRED')
    return
  }
  const gate = await client.privateRecoveryState.findUnique({ where: { singleton: true } })
  if ((gate?.checks as { controlledRecovery?: boolean } | undefined)?.controlledRecovery)
    assertControlledRecoveryConfig(config, true)
}
