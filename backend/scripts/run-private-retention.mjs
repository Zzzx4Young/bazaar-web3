#!/usr/bin/env node
import { RetentionService } from '../dist/delivery-files/retention.service.js'
import { lifecycleRuntime } from './private-lifecycle-runtime.mjs'
if (process.argv.length !== 3 || process.argv[2] !== '--once')
  throw new Error('Use --once; only eligible immutable private versions are considered')
const r = await lifecycleRuntime()
try {
  const service = new RetentionService(r.source.client, r.config.web3, r.store, r.ledger)
  let deleted = 0,
    protectedCount = 0
  for (const version of await r.source.client.privateFileVersion.findMany({
    orderBy: { id: 'asc' }
  })) {
    const state = await r.source.client.privateFileDisposition.findUnique({
      where: { versionId: version.id }
    })
    if (state?.state === 'deleted') continue
    if (!(await service.eligibility(version.id)).eligible) {
      protectedCount++
      continue
    }
    const claim = await service.claimDeletion(version.id)
    await service.confirmDeletion(claim.id)
    deleted++
  }
  console.log(JSON.stringify({ deleted, protected: protectedCount }))
} finally {
  await r.close()
}
