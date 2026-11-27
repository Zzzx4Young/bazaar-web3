import assert from 'node:assert/strict'
import test from 'node:test'
import { createEoaChecker } from '../dist/auth/wallet-account-type.js'
const config = { chainId: 11155111, rpcPrimary: 'https://rpc-one.invalid', rpcSecondary: 'https://rpc-two.invalid' }
const address = '0x' + '1'.repeat(40)
const healthy = async (_endpoint, method) => method === 'eth_chainId' ? '0xaa36a7' : '0x'

test('A14/A18: both sources must identify the target chain and empty latest/finalized code', async () => {
  const calls = []
  await createEoaChecker(config, async (...args) => { calls.push(args); return healthy(...args) })(address)
  assert.equal(calls.length, 6)
  assert.equal(calls.filter(c => c[1] === 'eth_getCode' && c[2][1] === 'finalized').length, 2)
})
test('A18: chain mismatch, RPC errors, invalid replies and mixed source state fail closed', async () => {
  for (const request of [
    async () => { throw new Error('RPC offline') },
    async () => null,
    async (_url, method) => method === 'eth_chainId' ? '0x1' : '0x',
    async (url, method) => method === 'eth_chainId' ? '0xaa36a7' : url === config.rpcPrimary ? '0x' : '0xef0100'
  ]) await assert.rejects(createEoaChecker(config, request)(address), /WALLET_UNAVAILABLE/)
})
test('A14: contract wallets and delegated EOA execution are not supported in this round', async () => {
  for (const code of ['0x60016000', '0xef0100' + '2'.repeat(40)]) {
    await assert.rejects(createEoaChecker(config, async (_url, method) => method === 'eth_chainId' ? '0xaa36a7' : code)(address), /INVALID_INPUT/)
  }
})
