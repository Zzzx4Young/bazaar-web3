import test from 'node:test'
import assert from 'node:assert/strict'
import { readWeb3Config } from '../dist/web3/web3-policy.js'
import { readPrivateLifecycleConfig } from '../dist/delivery-files/lifecycle-config.js'
const env = {
  WEB3_ENABLED: '1',
  WEB3_CHAIN_ID: '11155111',
  WEB3_TOKEN_ADDRESS: '0x' + '1'.repeat(40),
  WEB3_ESCROW_ADDRESS: '0x' + '2'.repeat(40),
  WEB3_RPC_PRIMARY: 'https://rpc-a.invalid',
  WEB3_RPC_SECONDARY: 'https://rpc-b.invalid',
  WEB3_SECURITY_LEDGER_ID: '5f37012e-4964-4d68-853f-efabc5568a0c',
  WEB3_SECURITY_LEDGER_URL: 'postgresql://ledger@127.0.0.1:55435/wallet_security',
  WEB3_RECOVERY_PROFILE: 'controlled'
}
test('T10 review: controlled profile refuses missing wallet and private checkpoint configuration', () => {
  assert.throws(() => readWeb3Config(env), /CONTROLLED_CHECKPOINT/)
  assert.throws(
    () => readPrivateLifecycleConfig({ WEB3_RECOVERY_PROFILE: 'controlled' }),
    /CONTROLLED_CHECKPOINT/
  )
})

test('T10 controlled bootstrap pins the private descriptor; a restored package cannot select its old valid checkpoint', async () => {
  const { assertControlledRecoveryConfig } = await import('../dist/auth/recovery-profile.js')
  const common = {
    environmentId: 'same-env',
    publicKeyFile: '/custodian/public.pem',
    historyFile: '/custodian/history'
  }
  const config = {
    web3: {
      controlledRecovery: true,
      securityCheckpoint: {
        ...common,
        configurationFile: '/custodian/wallet-C2.config',
        pairedPrivateConfigurationFile: '/custodian/private-C2.config'
      }
    },
    privateLifecycle: {
      checkpoint: { ...common, configurationFile: '/custodian/private-C1.config' }
    }
  }
  assert.throws(() => assertControlledRecoveryConfig(config), /CONTROLLED_CHECKPOINT/)
  config.privateLifecycle.checkpoint.configurationFile = '/custodian/private-C2.config'
  assert.doesNotThrow(() => assertControlledRecoveryConfig(config))
})
