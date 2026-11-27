#!/usr/bin/env node
import { DownloadService } from '../dist/delivery-files/download.service.js'
import { readConfig } from '../dist/config.js'
import { DatabaseService } from '../dist/database/database.service.js'
import { PrivateFileService } from '../dist/delivery-files/upload.service.js'
import { GaragePrivateObjectStore } from '../dist/delivery-files/object-store.js'
import { createPrivateUploadGateway } from '../dist/delivery-files/upload-gateway.js'
const config = readConfig(process.env),
  files = config.privateFiles
if (!files) throw new Error('Explicit private upload configuration required')
const address = new URL(files.uploadOrigin)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname))
  throw new Error('Gateway binds loopback only; configure TLS through a separate ingress')
const db = new DatabaseService(config.databaseUrl, config.databasePool)
await db.onModuleInit()
const server = createPrivateUploadGateway(
  new PrivateFileService(
    db.client,
    new GaragePrivateObjectStore(files.store),
    files.budget,
    files.uploadKey
  ),
  config.appOrigin,
  config.web3 ? new DownloadService(db.client,config.web3,new GaragePrivateObjectStore(files.store),files.uploadOrigin,files.uploadKey) : undefined
)
await new Promise((done, reject) => {
  server.once('error', reject)
  server.listen(Number(address.port || 80), '127.0.0.1', done)
})
process.stdout.write('Private upload gateway ready on configured loopback origin\n')
let closing = false
const close = async () => {
  if (closing) return
  closing = true
  server.closeIdleConnections()
  await new Promise((done) => server.close(done))
  await db.onModuleDestroy()
}
process.on('SIGTERM', () => {
  void close()
})
process.on('SIGINT', () => {
  void close()
})
