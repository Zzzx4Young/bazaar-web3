import test from 'node:test'
import assert from 'node:assert/strict'
import { ChainIndexer } from '../dist/web3/chain-indexer.js'
test('A13 worker rejects an absent checkpoint instead of auto-starting a clean history', async () => {
  const client = { scanCheckpoint: { findUnique: async () => null } }
  const observer = { config: { chainId: 11155111, escrow: '0x' + '1'.repeat(40) } }
  await assert.rejects(
    new ChainIndexer(client, observer).runOnce(),
    (e) => e.kind === 'unavailable'
  )
})
