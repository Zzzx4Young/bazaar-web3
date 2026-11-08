import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readChainDeployment } from '../dist/web3/chain-config.js'
const valid = {
  deploymentBlock: '123',
  escrowCodeHash: '0x' + '1'.repeat(64),
  tokenCodeHash: '0x' + '2'.repeat(64),
  administrator: '0x' + '3'.repeat(40),
  arbitrator: '0x' + '4'.repeat(40)
}
test('T07 pinned deployment rejects writable configuration, wrong roles and unknown fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bazaar-t07-config-')),
    file = join(root, 'deployment.json')
  try {
    await writeFile(file, JSON.stringify(valid), { mode: 0o600 })
    assert.deepEqual(readChainDeployment(file), valid)
    await chmod(file, 0o660)
    assert.throws(() => readChainDeployment(file), /Unsafe/)
    await chmod(file, 0o600)
    for (const input of [
      { ...valid, arbitrator: valid.administrator },
      { ...valid, deploymentBlock: '-1' },
      { ...valid, escrowCodeHash: '0x12' },
      { ...valid, latest: true }
    ]) {
      await writeFile(file, JSON.stringify(input))
      assert.throws(() => readChainDeployment(file))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
