// Dedicated ephemeral EVM only. Both observer endpoints proxy the SAME node; they
// are not independent providers. Call mutation helpers sequentially per fixture.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { createServer as createReservation } from 'node:net'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  zeroAddress,
  zeroHash
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { LocalPaymentSigner, orderTermsDigest } from '../../dist/web3/payment-signer.js'

const chainId = 11155111
const identifier = () => '0x' + randomBytes(32).toString('hex')
const account = () => privateKeyToAccount(generatePrivateKey())
const contracts = new URL('../../../contracts/', import.meta.url)
const artifact = async (name) =>
  JSON.parse(await readFile(new URL(`out/${name}.sol/${name}.json`, contracts), 'utf8'))

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  return server.address().port
}

async function stopServer(server) {
  if (!server.listening) return
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
    server.closeAllConnections?.()
  })
}

// No upstream chosen by the request, no forwarding of ambient credentials.
function proxy(rpc) {
  return createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/') {
      res.writeHead(405).end()
      return
    }
    const upstream = httpRequest(
      rpc,
      { method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 5000 },
      (response) => {
        res.writeHead(response.statusCode, { 'content-type': 'application/json' })
        response.pipe(res)
      }
    )
    upstream.on('timeout', () => upstream.destroy())
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.on('aborted', () => upstream.destroy())
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  })
}

export async function localEscrow() {
  const servers = []
  let child, exited, childError, closing
  const close = () => {
    if (closing) return closing
    closing = (async () => {
      // Stop the owned node first, which also ends any in-flight proxy requests.
      if (child && child.exitCode === null && child.signalCode === null && !childError) {
        child.kill('SIGTERM')
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
        try {
          await exited
        } finally {
          clearTimeout(timer)
        }
      }
      const results = await Promise.allSettled(servers.map(stopServer))
      const failed = results.find((r) => r.status === 'rejected')
      if (failed) throw failed.reason
    })()
    return closing
  }
  try {
    const names = ['BazaarTestToken', 'BazaarEscrow', 'Safe', 'SafeProxy', 'LockedSafeGuard']
    const loaded = await Promise.all(names.map(artifact))
    const artifacts = Object.fromEntries(names.map((name, i) => [name, loaded[i]]))
    const abi = {
      token: artifacts.BazaarTestToken.abi,
      escrow: artifacts.BazaarEscrow.abi,
      safe: artifacts.Safe.abi,
      guard: artifacts.LockedSafeGuard.abi
    }
    const reservation = createReservation()
    servers.push(reservation)
    const port = await listen(reservation)
    await stopServer(reservation)
    const rpc = `http://127.0.0.1:${port}`
    child = spawn(
      fileURLToPath(new URL('node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil', contracts)),
      [
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--chain-id',
        String(chainId),
        '--hardfork',
        'prague',
        '--mnemonic-random',
        '--accounts',
        '1',
        '--quiet',
        '--no-cors'
      ],
      {
        cwd: fileURLToPath(contracts),
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        stdio: 'ignore'
      }
    )
    // The node generates its mnemonic internally: never in argv, env or output.
    exited = new Promise((resolve) => {
      child.once('exit', resolve)
      child.once('error', (error) => {
        childError = error
        resolve()
      })
    })
    const chain = defineChain({
      id: chainId,
      name: 'Dedicated local escrow',
      nativeCurrency: { name: 'Local Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpc] } }
    })
    const transport = () => http(rpc, { retryCount: 0, timeout: 2000 })
    const publicClient = createPublicClient({
      chain,
      transport: transport(),
      pollingInterval: 20,
      cacheTime: 0
    })
    let ready = false
    for (let i = 0; i < 100; i++) {
      if (childError || child.exitCode !== null || child.signalCode !== null)
        throw new Error('Dedicated Anvil failed to start')
      try {
        ready = (await publicClient.getChainId()) === chainId
      } catch {
        /* startup only */
      }
      if (ready) break
      await delay(30)
    }
    if (!ready) throw new Error('Dedicated Anvil startup timed out')
    // Give bind failures time to surface before using a port we just reserved.
    await delay(30)
    if (childError || child.exitCode !== null || child.signalCode !== null)
      throw new Error('Dedicated Anvil exited during startup')
    const receipt = async (hash) => {
      const r = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 15000,
        pollingInterval: 20
      })
      if (r.status !== 'success') throw new Error('Local EVM transaction reverted')
      return r
    }
    const wallet = (who) => createWalletClient({ chain, account: who, transport: transport() })
    const read = (address, contractAbi, functionName, args = []) =>
      publicClient.readContract({ address, abi: contractAbi, functionName, args })
    const write = async (who, address, contractAbi, functionName, args = []) => {
      const { request } = await publicClient.simulateContract({
        account: who,
        address,
        abi: contractAbi,
        functionName,
        args
      })
      return receipt(await wallet(who).writeContract(request))
    }
    const events = (r, contractAbi, eventName, address) =>
      parseEventLogs({
        abi: contractAbi,
        eventName,
        strict: true,
        logs: address
          ? r.logs.filter((log) => log.address.toLowerCase() === address.toLowerCase())
          : r.logs
      })
    const [faucet] = await wallet(undefined).getAddresses()
    if (!faucet) throw new Error('Dedicated Anvil faucet missing')
    const deployer = account(),
      buyer = account(),
      seller = account()
    for (const who of [deployer, buyer, seller]) {
      await receipt(
        await wallet(faucet).sendTransaction({ to: who.address, value: parseEther('100') })
      )
    }
    const deploy = async (name, args = []) => {
      const a = artifacts[name]
      const r = await receipt(
        await wallet(deployer).deployContract({ abi: a.abi, bytecode: a.bytecode.object, args })
      )
      if (!r.contractAddress) throw new Error('Local contract deployment missing address')
      return { address: r.contractAddress.toLowerCase(), receipt: r }
    }
    const safeExecute = async (address, owners, to, data) => {
      const nonce = await read(address, abi.safe, 'nonce')
      const args = [to, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress]
      const hash = await read(address, abi.safe, 'getTransactionHash', [...args, nonce])
      const sorted = [...owners].sort((a, b) =>
        a.address.toLowerCase().localeCompare(b.address.toLowerCase())
      )
      const signatures = await Promise.all(sorted.slice(0, 2).map((owner) => owner.sign({ hash })))
      const r = await write(deployer, address, abi.safe, 'execTransaction', [
        ...args,
        concatHex(signatures)
      ])
      const successes = events(r, abi.safe, 'ExecutionSuccess', address)
      if (
        successes.length !== 1 ||
        successes[0].args.txHash !== hash ||
        events(r, abi.safe, 'ExecutionFailure', address).length
      ) {
        throw new Error('Safe execution did not succeed')
      }
      return r
    }
    const singleton = (await deploy('Safe')).address
    const guard = (await deploy('LockedSafeGuard')).address
    const owners = {
      administrator: [account(), account(), account()],
      arbitrator: [account(), account(), account()]
    }
    const makeSafe = async (members) => {
      const address = (await deploy('SafeProxy', [singleton])).address
      await write(deployer, address, abi.safe, 'setup', [
        members.map((member) => member.address),
        2n,
        zeroAddress,
        '0x',
        zeroAddress,
        zeroAddress,
        0n,
        zeroAddress
      ])
      await safeExecute(
        address,
        members,
        address,
        encodeFunctionData({ abi: abi.safe, functionName: 'setGuard', args: [guard] })
      )
      return address
    }
    const administrator = await makeSafe(owners.administrator)
    const arbitrator = await makeSafe(owners.arbitrator)
    const token = (await deploy('BazaarTestToken', [deployer.address, 1_000_000_000_000n])).address
    const escrowDeployment = await deploy('BazaarEscrow', [token, administrator, arbitrator])
    const escrow = escrowDeployment.address
    const paymentKey = generatePrivateKey()
    const paymentAccount = privateKeyToAccount(paymentKey)
    const deliveryAccount = account()
    const paymentKeyId = identifier(),
      deliveryKeyId = identifier()
    const paymentSigner = new LocalPaymentSigner(paymentKey, paymentKeyId)
    const timestamp = async () => Number((await publicClient.getBlock()).timestamp)
    const now = await timestamp()
    for (const [kind, keyId, signer] of [
      [0, paymentKeyId, paymentAccount],
      [1, deliveryKeyId, deliveryAccount]
    ]) {
      await safeExecute(
        administrator,
        owners.administrator,
        escrow,
        encodeFunctionData({
          abi: abi.escrow,
          functionName: 'configureSigner',
          args: [kind, keyId, signer.address, BigInt(now), BigInt(now + 30 * 86400)]
        })
      )
    }
    for (const who of [buyer, seller])
      await write(who, token, abi.token, 'approve', [escrow, 1_000_000_000_000n])
    const paymentPermit = async (overrides = {}) => {
      const issuedAt = await timestamp()
      return {
        schemaVersion: 1,
        orderId: identifier(),
        stockId: identifier(),
        stockGeneration: '0',
        previousOrderId: zeroHash,
        chainId,
        buyer: buyer.address,
        refundAddress: buyer.address,
        seller: seller.address,
        token,
        escrow,
        amountAtoms: '1000001',
        commitmentHash: identifier(),
        intentId: identifier(),
        issuedAt,
        payDeadline: issuedAt + 1800,
        signerKeyId: paymentKeyId,
        ...overrides
      }
    }
    const deliveryPermit = async (orderId, overrides = {}) => {
      const issuedAt = await timestamp()
      const o = await read(escrow, abi.escrow, 'orders', [orderId])
      return {
        schemaVersion: 1,
        credentialId: identifier(),
        orderId,
        seller: o.seller,
        deliveryVersion: identifier(),
        manifestCommitment: identifier(),
        issuedAt,
        expiresAt: Math.min(issuedAt + 1000, Number(o.fundedAt) + 259200),
        signerKeyId: deliveryKeyId,
        ...overrides
      }
    }
    const deliveryTypes = {
      DeliveryPermit: abi.escrow
        .find((item) => item.type === 'function' && item.name === 'registerDelivery')
        .inputs[0].components.map(({ name, type }) => ({ name, type }))
    }
    const signDelivery = (permit) =>
      deliveryAccount.signTypedData({
        domain: { name: 'Bazaar Testnet Escrow', version: '1', chainId, verifyingContract: escrow },
        types: deliveryTypes,
        primaryType: 'DeliveryPermit',
        message: permit
      })
    const warpMine = async (at) => {
      await publicClient.request({ method: 'evm_setNextBlockTimestamp', params: [Number(at)] })
      await publicClient.request({ method: 'evm_mine', params: [] })
    }
    const config = { chainId, tokenDecimals: 6, token, escrow }
    for (const key of ['rpcPrimary', 'rpcSecondary']) {
      const server = proxy(rpc)
      servers.push(server)
      config[key] = `http://127.0.0.1:${await listen(server)}`
    }
    return {
      config,
      deployment: {
        deploymentBlock: escrowDeployment.receipt.blockNumber.toString(),
        escrowCodeHash: keccak256(await publicClient.getCode({ address: escrow })),
        tokenCodeHash: keccak256(await publicClient.getCode({ address: token })),
        administrator,
        arbitrator
      },
      rpc,
      publicClient,
      abi,
      buyer,
      seller,
      deployer,
      owners,
      guard,
      singleton,
      signers: {
        payment: {
          address: paymentAccount.address,
          keyId: paymentKeyId,
          sign: (p) => paymentSigner.sign(p)
        },
        delivery: { address: deliveryAccount.address, keyId: deliveryKeyId, sign: signDelivery }
      },
      paymentSigner,
      paymentPermit,
      deliveryPermit,
      orderTermsDigest,
      read,
      write,
      safeExecute,
      events,
      timestamp,
      warpMine,
      // Fixed-supply token: transfer from the fixture treasury, never mint.
      mintTransfer: (to, amount) =>
        write(deployer, token, abi.token, 'transfer', [to, BigInt(amount)]),
      balance: (who) => read(token, abi.token, 'balanceOf', [who]),
      deposit: async (p, who = buyer, signature) =>
        write(who, escrow, abi.escrow, 'deposit', [p, signature ?? (await paymentSigner.sign(p))]),
      deliver: async (p, who = seller, signature) =>
        write(who, escrow, abi.escrow, 'registerDelivery', [
          p,
          signature ?? (await signDelivery(p))
        ]),
      dispute: (id, evidence = identifier(), who = buyer) =>
        write(who, escrow, abi.escrow, 'openDispute', [id, evidence]),
      accept: (id, who = buyer) => write(who, escrow, abi.escrow, 'accept', [id]),
      refundTimeout: (id) => write(deployer, escrow, abi.escrow, 'refundDisputeTimeout', [id]),
      close
    }
  } catch (error) {
    try {
      await close()
    } catch {
      throw new Error('Local escrow setup and cleanup failed')
    }
    throw error
  }
}
