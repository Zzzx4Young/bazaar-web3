import test from 'node:test'
import assert from 'node:assert/strict'
import { DualChainObserver } from '../dist/web3/chain-observer.js'
const hash = (n) => '0x' + n.toString(16).padStart(64, '0')
const config = {
  chainId: 11155111,
  token: '0x' + '1'.repeat(40),
  escrow: '0x' + '2'.repeat(40),
  rpcPrimary: 'https://one.invalid',
  rpcSecondary: 'https://two.invalid'
}
const deployment = {
  deploymentBlock: '0',
  escrowCodeHash: hash(10),
  tokenCodeHash: hash(11),
  administrator: '0x' + '3'.repeat(40),
  arbitrator: '0x' + '4'.repeat(40)
}
function fixture({
  heads = [12, 10],
  conflict = false,
  offline = false,
  broken = false,
  chain = false
} = {}) {
  const calls = []
  const rpc = async (endpoint, method, params) => {
    calls.push({ endpoint, method, params })
    const source = endpoint === config.rpcPrimary ? 0 : 1
    if (offline && source === 1) throw new Error('provider down with secret URL')
    if (method === 'eth_chainId') return chain ? '0x1' : '0xaa36a7'
    let height
    if (method === 'eth_getBlockByNumber')
      height = params[0] === 'finalized' ? heads[source] : Number(BigInt(params[0]))
    else if (method === 'eth_getBlockByHash') height = Number(BigInt(params[0])) - 100
    else throw new Error('unexpected ' + method)
    if (height < 0) throw new Error('missing')
    return {
      number: '0x' + height.toString(16),
      hash: conflict && source === 1 && height === 10 ? hash(999) : hash(height + 100),
      parentHash: broken && source === 0 ? hash(998) : hash(height + 99),
      timestamp: '0x' + (1000 + height).toString(16)
    }
  }
  return { observer: new DualChainObserver(config, deployment, rpc), calls }
}
test('A12 common finalized height accepts unequal heads only after ancestry verification', async () => {
  const f = fixture(),
    s = await f.observer.readVerifiedSnapshot()
  assert.equal(s.height, '10')
  assert.equal(s.hash, hash(110))
  assert.equal(s.timestamp, 1010)
  assert.equal(f.calls.filter((c) => c.method === 'eth_getBlockByHash').length, 2)
})
for (const [name, options, kind] of [
  ['same-height hash conflict', { conflict: true }, 'contradiction'],
  ['one source offline', { offline: true }, 'unavailable'],
  ['broken ancestry', { broken: true }, 'contradiction'],
  ['wrong chain', { chain: true }, 'contradiction']
])
  test('A12 refuses ' + name + ' without accepting one source', async () => {
    const f = fixture(options)
    await assert.rejects(
      f.observer.readVerifiedSnapshot(),
      (e) => e.kind === kind && !e.message.includes('secret URL')
    )
  })
test('A12 ancestry budget exhaustion is unavailable, not proof of a fork', async () => {
  const f = fixture({ heads: [1000, 1] })
  await assert.rejects(f.observer.readVerifiedSnapshot(), (e) => e.kind === 'unavailable')
})
test('A07 historical scan never substitutes latest state when block-hash queries fail', async () => {
  const f = fixture()
  await assert.rejects(f.observer.scanAndVerify('0', []), (e) => e.kind === 'unavailable')
})
test('A12 source object key ordering is not a state contradiction', async () => {
  const o = new DualChainObserver(config, deployment, async (source) =>
    source === config.rpcPrimary ? { a: 1, b: { c: 2, d: 3 } } : { b: { d: 3, c: 2 }, a: 1 }
  )
  assert.deepEqual(await o.same('test', []), { a: 1, b: { c: 2, d: 3 } })
})
test('A13 bounded historical ancestry resumes validation without rejecting a valid long history', async () => {
  const f = fixture({ heads: [600, 600] }),
    head = await f.observer.readVerifiedSnapshot()
  await assert.rejects(f.observer.atHeight('0', head), (e) => e.kind === 'unavailable')
  const verified = await f.observer.atHeight('0', head)
  assert.equal(verified.hash, hash(100))
  assert.equal(verified.height, '0')
})
test('A07/A20 payment reconciliation cannot confirm or release ahead of the complete projected H', async () => {
  const { CheckpointPaymentObserver } = await import('../dist/web3/payment-observer.js')
  const snapshot = {
    chainId: 11155111,
    height: '11',
    hash: hash(111),
    timestamp: 1011,
    verifiedBy: [config.rpcPrimary, config.rpcSecondary],
    verifiedAt: new Date()
  }
  const { deploymentDigest } = await import('../dist/web3/escrow-projector.js')
  const client = {
    scanCheckpoint: {
      findUnique: async () => ({
        status: 'active',
        height: 10n,
        hash: hash(110),
        deploymentBlock: 0n,
        configHash: deploymentDigest(config, deployment)
      })
    }
  }
  const observer = {
    config,
    deployment,
    readVerifiedSnapshot: async () => snapshot,
    atHeight: async () => ({ height: '10', hash: hash(110) }),
    readIntent: async () => ({
      snapshot,
      intentId: hash(1),
      orderId: hash(2),
      stockId: hash(3),
      orderState: 'None',
      intentRevoked: true,
      signerRevoked: false,
      stockGeneration: '0',
      stockOccupant: hash(0),
      orderTermsHash: null
    })
  }
  await assert.rejects(
    new CheckpointPaymentObserver(client, observer).readIntent({}),
    (e) => e.kind === 'unavailable'
  )
})
test('A13 finalized conflict retains both source block identities as redacted incident evidence', async () => {
  const f = fixture({ conflict: true })
  await assert.rejects(
    f.observer.readVerifiedSnapshot(),
    (e) =>
      e.kind === 'contradiction' &&
      e.evidence?.common?.[0]?.hash === hash(110) &&
      e.evidence?.common?.[1]?.hash === hash(999)
  )
})
test('T07 review: more than 2048 historical order ids are checked in bounded batches instead of permanently stopping', async () => {
  const { encodeFunctionResult, decodeFunctionData, erc20Abi, keccak256 } = await import('viem')
  const { escrowAbi } = await import('../dist/web3/escrow-abi.js')
  const base = fixture({ heads: [10, 10] }),
    code = '0x6000',
    d = { ...deployment, escrowCodeHash: keccak256(code), tokenCodeHash: keccak256(code) }
  const none = {
    state: 0,
    buyer: '0x' + '0'.repeat(40),
    refundAddress: '0x' + '0'.repeat(40),
    seller: '0x' + '0'.repeat(40),
    amountAtoms: 0n,
    stockId: hash(0),
    generation: 0n,
    fundedAt: 0n,
    deliveredAt: 0n,
    disputedAt: 0n,
    credentialId: hash(0),
    deliveryVersion: hash(0),
    manifestCommitment: hash(0)
  }
  const rpc = async (source, method, params) => {
    if (method === 'eth_getCode') return code
    if (method === 'eth_getLogs') return []
    if (method === 'eth_call') {
      const abi = params[0].to === config.token ? erc20Abi : escrowAbi
      const { functionName } = decodeFunctionData({ abi, data: params[0].data })
      const values = {
        token: config.token,
        administrator: d.administrator,
        arbitrator: d.arbitrator,
        decimals: 6,
        orders: none,
        orderTermsHash: hash(0),
        outstanding: 0n,
        totalDeposited: 0n,
        totalPaid: 0n,
        balanceOf: 0n,
        depositPaused: false
      }
      assert.ok(functionName in values, 'unexpected fixture contract function')
      return encodeFunctionResult({ abi, functionName, result: values[functionName] })
    }
    return base.observer.rpc(source, method, params)
  }
  const observer = new DualChainObserver(config, d, rpc),
    result = await observer.scanAndVerify(
      '0',
      Array.from({ length: 2049 }, (_, i) => hash(i + 10000))
    )
  assert.equal(result.orders.length, 2049)
  assert.equal(result.globals.outstanding, '0')
})
