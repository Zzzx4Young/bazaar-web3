import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import httpModule from 'node:http'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { encodeFunctionData, keccak256 } from 'viem'

const id = () => '0x' + randomBytes(32).toString('hex')

test(
  'local escrow: signed deposit, delivery, dispute and actual Safe full refund',
  { timeout: 90000 },
  async (t) => {
    let helper
    try {
      helper = await import('./helpers/local-escrow.mjs')
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
    assert.equal(typeof helper?.localEscrow, 'function', 'localEscrow helper must exist')
    const f = await helper.localEscrow()
    t.after(() => f.close())
    const { publicClient: client, abi, config, deployment, buyer, seller } = f
    assert.equal(await client.getChainId(), 11155111)
    for (const address of [
      config.token,
      config.escrow,
      deployment.administrator,
      deployment.arbitrator
    ]) {
      assert.equal(address, address.toLowerCase(), 'public deployment addresses must be normalized')
    }
    assert.notEqual(config.rpcPrimary, config.rpcSecondary)
    assert.equal(
      deployment.escrowCodeHash,
      keccak256(await client.getCode({ address: config.escrow }))
    )
    assert.equal(
      deployment.tokenCodeHash,
      keccak256(await client.getCode({ address: config.token }))
    )
    assert.notEqual(deployment.administrator, deployment.arbitrator)
    for (const address of [deployment.administrator, deployment.arbitrator]) {
      assert.equal(await f.read(address, abi.safe, 'getThreshold'), 2n)
      assert.equal((await f.read(address, abi.safe, 'getOwners')).length, 3)
      const [modules] = await f.read(address, abi.safe, 'getModulesPaginated', [
        '0x0000000000000000000000000000000000000001',
        10n
      ])
      assert.deepEqual(modules, [])
    }
    const principal = 1000001n
    await f.mintTransfer(buyer.address, principal)
    const before = await f.balance(buyer.address)
    const sellerBefore = await f.balance(seller.address)
    const p = await f.paymentPermit({
      orderId: id(),
      stockId: id(),
      intentId: id(),
      commitmentHash: id(),
      amountAtoms: principal.toString()
    })
    assert.equal(p.payDeadline - p.issuedAt, 1800)
    const funded = await f.deposit(p)
    const deposited = f.events(funded, abi.escrow, 'Deposited', config.escrow)
    assert.equal(deposited.length, 1)
    assert.equal(deposited[0].args.amountAtoms, principal)
    assert.equal(
      await f.read(config.escrow, abi.escrow, 'orderTermsHash', [p.orderId]),
      f.orderTermsDigest(p)
    )
    const d = await f.deliveryPermit(p.orderId)
    const delivered = await f.deliver(d)
    assert.equal(
      f.events(delivered, abi.escrow, 'DeliveryRegistered', config.escrow)[0].args.credentialId,
      d.credentialId
    )
    const disputed = await f.dispute(p.orderId, id())
    assert.equal(f.events(disputed, abi.escrow, 'DisputeOpened', config.escrow).length, 1)
    const data = encodeFunctionData({
      abi: abi.escrow,
      functionName: 'resolveDispute',
      args: [p.orderId, true, id()]
    })
    await assert.rejects(
      f.safeExecute(deployment.arbitrator, f.owners.arbitrator.slice(0, 1), config.escrow, data)
    )
    const refunded = await f.safeExecute(
      deployment.arbitrator,
      f.owners.arbitrator,
      config.escrow,
      data
    )
    assert.equal(refunded.status, 'success')
    assert.equal(f.events(refunded, abi.safe, 'ExecutionSuccess', deployment.arbitrator).length, 1)
    assert.equal(
      f.events(refunded, abi.escrow, 'Refunded', config.escrow)[0].args.amountAtoms,
      principal
    )
    const o = await f.read(config.escrow, abi.escrow, 'orders', [p.orderId])
    assert.equal(o.state, 5)
    assert.equal(o.credentialId, d.credentialId)
    assert.equal(o.deliveryVersion, d.deliveryVersion)
    assert.equal(o.manifestCommitment, d.manifestCommitment)
    assert.equal(await f.balance(buyer.address), before)
    assert.equal(await f.balance(seller.address), sellerBefore)
    assert.equal(await f.read(config.escrow, abi.escrow, 'outstanding'), 0n)
    await assert.rejects(
      f.safeExecute(deployment.arbitrator, f.owners.arbitrator, config.escrow, data)
    )
    await assert.rejects(
      f.safeExecute(
        deployment.administrator,
        f.owners.administrator,
        deployment.administrator,
        encodeFunctionData({ abi: abi.safe, functionName: 'changeThreshold', args: [1n] })
      )
    )
    for (const endpoint of [config.rpcPrimary, config.rpcSecondary]) {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBlockByNumber',
          params: ['latest', false]
        }),
        headers: { 'content-type': 'application/json' }
      })
      assert.equal(
        (await response.json()).result.number,
        '0x' + (await client.getBlockNumber({ cacheTime: 0 })).toString(16)
      )
    }
    // The same fixture also exposes ordinary acceptance and the public timeout exit.
    await f.mintTransfer(buyer.address, principal * 2n)
    const acceptedPermit = await f.paymentPermit()
    await f.deposit(acceptedPermit)
    await f.deliver(await f.deliveryPermit(acceptedPermit.orderId))
    const accepted = await f.accept(acceptedPermit.orderId)
    assert.equal(
      f.events(accepted, abi.escrow, 'Released', config.escrow)[0].args.amountAtoms,
      principal
    )
    assert.equal(await f.balance(seller.address), sellerBefore + principal)
    const timeoutPermit = await f.paymentPermit()
    await f.deposit(timeoutPermit)
    await f.deliver(await f.deliveryPermit(timeoutPermit.orderId))
    await f.dispute(timeoutPermit.orderId)
    const frozen = await f.read(config.escrow, abi.escrow, 'orders', [timeoutPermit.orderId])
    await f.warpMine(frozen.disputedAt + 604800n)
    const timeout = await f.refundTimeout(timeoutPermit.orderId)
    assert.equal(
      f.events(timeout, abi.escrow, 'Refunded', config.escrow)[0].args.amountAtoms,
      principal
    )
    assert.equal(await f.balance(buyer.address), before + principal)
    assert.equal(await f.balance(config.escrow), 0n)
    assert.equal(await f.read(config.escrow, abi.escrow, 'outstanding'), 0n)
    // Anvil 1.5's local finalized tag is 64 blocks behind latest. Never set
    // finalized directly: mine and query the real tag through both proxies.
    const target = await client.getBlock({ blockTag: 'latest' })
    assert.ok((await client.getBlock({ blockTag: 'finalized' })).number < target.number)
    await client.request({ method: 'anvil_mine', params: ['0x3f'] })
    assert.equal((await client.getBlock({ blockTag: 'finalized' })).number, target.number - 1n)
    await client.request({ method: 'evm_mine', params: [] })
    const finalized = await client.getBlock({ blockTag: 'finalized' })
    assert.equal(finalized.number, target.number)
    assert.equal(finalized.hash, target.hash)
    t.diagnostic('Anvil local finalized tag: 63 empty blocks insufficient; 64 sufficient')
    for (const endpoint of [config.rpcPrimary, config.rpcSecondary]) {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_getBlockByNumber',
          params: ['finalized', false]
        }),
        headers: { 'content-type': 'application/json' }
      })
      assert.equal((await response.json()).result.hash, target.hash)
    }
    await f.close()
    await f.close()
    for (const endpoint of [f.rpc, config.rpcPrimary, config.rpcSecondary]) {
      await assert.rejects(fetch(endpoint, { signal: AbortSignal.timeout(1000) }))
    }
  }
)

test(
  'local escrow: late setup failure closes its own node and first proxy',
  { timeout: 90000 },
  async (t) => {
    const { localEscrow } = await import('./helpers/local-escrow.mjs')
    const originalSpawn = childProcess.spawn
    const originalCreate = httpModule.createServer
    let child
    let firstProxy
    let proxyCount = 0
    t.after(() => {
      t.mock.restoreAll()
      syncBuiltinESMExports()
    })
    t.mock.method(childProcess, 'spawn', (...args) => {
      assert.deepEqual(Object.keys(args[2].env), ['PATH'])
      assert.equal(args[2].stdio, 'ignore')
      assert.ok(args[1].includes('--mnemonic-random'))
      child = originalSpawn(...args)
      return child
    })
    t.mock.method(httpModule, 'createServer', (...args) => {
      const server = originalCreate(...args)
      proxyCount++
      if (proxyCount === 1) firstProxy = server
      if (proxyCount === 2) {
        server.listen = () => {
          process.nextTick(() =>
            server.emit('error', new Error('synthetic second proxy bind failure'))
          )
          return server
        }
      }
      return server
    })
    syncBuiltinESMExports()
    await assert.rejects(localEscrow(), /synthetic second proxy bind failure/)
    assert.ok(child)
    assert.ok(child.exitCode !== null || child.signalCode !== null)
    assert.equal(firstProxy.listening, false)
  }
)
