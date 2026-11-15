import { assertWalletLedgerGrants } from '../../dist/auth/wallet-ledger-grants.js'
import { assertAuthRuntimeGrants } from '../../dist/auth/auth-runtime-grants.js'
// Isolated integration child; no custodian key is passed to runtime.
import process from 'node:process'
import { createInterface } from 'node:readline'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createApp } from '../../dist/app.js'
import { readConfig } from '../../dist/config.js'
import { DatabaseService } from '../../dist/database/database.service.js'
import { requireLedgerWitness } from '../../dist/auth/ledger-witness.js'
import { PostgresWalletSecurityLedger } from '../../dist/auth/postgres-wallet-security-ledger.js'
import { readPublicationRuntimeConfig } from '../../dist/auth/publication-runtime.js'
let app,
  db,
  closing = false,
  stage = 'INPUT'
async function close(code = 0) {
  if (closing) return
  closing = true
  try {
    await app?.close()
    await db?.onModuleDestroy()
  } finally {
    process.exit(code)
  }
}
const input = createInterface({ input: process.stdin })
input.once('line', async (line) => {
  try {
    const m = JSON.parse(line)
    stage = 'DROP'
    process.stderr.write('API_CHILD_DROP\n')
    if (process.getuid() === 0) {
      process.setgroups([m.parentGid])
      process.setgid(65534)
      process.setuid(65534)
    }
    if (process.getuid() !== 65534) throw new Error('RUNTIME_UID_REQUIRED')
    stage = 'CONFIG'
    process.stderr.write('API_CHILD_CONFIG\n')
    const config = readConfig({ DATABASE_URL: m.databaseUrl, APP_ORIGIN: 'http://localhost:3000' })
    config.web3 = {
      ...m.web3,
      publication: readPublicationRuntimeConfig({
        WEB3_PUBLICATION_RUNTIME_CONFIG_FILE: m.publicationFile
      })
    }
    stage = 'DATABASE'
    process.stderr.write('API_CHILD_DATABASE\n')
    db = new DatabaseService(m.securityUrl)
    await db.onModuleInit()
    await assertWalletLedgerGrants(db.client, true)
    stage = 'WITNESS'
    process.stderr.write('API_CHILD_WITNESS\n')
    const witness = requireLedgerWitness(db.client, config.web3)
    try {
      await access(m.web3.securityWitnessDirectory + '/head.json')
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      await witness.initializeFresh()
    }
    const ledger = new PostgresWalletSecurityLedger(db.client, m.web3.securityLedgerId)
    stage = 'APP'
    process.stderr.write('API_CHILD_APP\n')
    app = await createApp(config, false, { walletLedger: ledger, walletEoaCheck: async () => {} })
    await assertAuthRuntimeGrants(app.get(DatabaseService).client)
    stage = 'LISTEN'
    await app.listen(0, '127.0.0.1')
    let signerReadDenied = false
    try {
      await access(m.signerFile, constants.R_OK)
    } catch (e) {
      signerReadDenied = ['EACCES', 'EPERM'].includes(e.code)
    }
    process.stdout.write(
      JSON.stringify({
        type: 'ready',
        pid: process.pid,
        port: app.getHttpServer().address().port,
        uid: process.getuid(),
        walletRoleRestricted: true,
        businessRoleRestricted: true,
        signerReadDenied
      }) + '\n'
    )
  } catch {
    process.stdout.write(
      JSON.stringify({ type: 'failed', stage, code: 'ISOLATED_API_START_FAILED' }) + '\n'
    )
    await close(1)
  }
})
input.once('close', () => void close())
process.on('SIGTERM', () => void close())
process.on('SIGINT', () => void close())
