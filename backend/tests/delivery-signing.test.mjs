import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generatePrivateKey } from 'viem/accounts'
import { recoverTypedDataAddress } from 'viem'
import {
  readDeliverySigner,
  deliveryTypedData
} from '../dist/delivery-files/delivery-permit.service.js'
const h = (n) => '0x' + n.toString(16).padStart(64, '0')
const config = { chainId: 11155111, escrow: '0x' + '2'.repeat(40) }

test('delivery key configuration rejects payment-key reuse and group-readable secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bazaar-delivery-key-'))
  const payment = join(root, 'payment.json'),
    delivery = join(root, 'delivery.json')
  try {
    const key = generatePrivateKey()
    await writeFile(payment, JSON.stringify({ key, keyId: h(1) }), { mode: 0o600 })
    await writeFile(delivery, JSON.stringify({ key, keyId: h(2) }), { mode: 0o600 })
    assert.throws(
      () => readDeliverySigner(delivery, { ...config, paymentSignerFile: payment }),
      /keys must differ/
    )
    await writeFile(delivery, JSON.stringify({ key: generatePrivateKey(), keyId: h(2) }), {
      mode: 0o600
    })
    assert.ok(readDeliverySigner(delivery, { ...config, paymentSignerFile: payment }))
    await chmod(delivery, 0o640)
    assert.throws(() => readDeliverySigner(delivery, config), /Unsafe delivery signer/)
    assert.equal(readDeliverySigner(undefined, config), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('delivery EIP-712 signatures bind chain and contract independently of the payment channel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bazaar-delivery-domain-'))
  try {
    const file = join(root, 'delivery.json')
    await writeFile(file, JSON.stringify({ key: generatePrivateKey(), keyId: h(2) }), {
      mode: 0o600
    })
    const signer = readDeliverySigner(file, config)
    const permit = {
      schemaVersion: 1,
      credentialId: h(3),
      orderId: h(4),
      seller: '0x' + '3'.repeat(40),
      deliveryVersion: h(5),
      manifestCommitment: h(6),
      issuedAt: 100,
      expiresAt: 200,
      signerKeyId: h(2)
    }
    const signature = await signer.sign(permit)
    assert.equal(
      (
        await recoverTypedDataAddress({ ...deliveryTypedData(permit, config), signature })
      ).toLowerCase(),
      signer.address
    )
    for (const wrong of [
      { ...config, chainId: 31337 },
      { ...config, escrow: '0x' + '4'.repeat(40) }
    ])
      assert.notEqual(
        (
          await recoverTypedDataAddress({ ...deliveryTypedData(permit, wrong), signature })
        ).toLowerCase(),
        signer.address
      )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
