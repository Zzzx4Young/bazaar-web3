import { readPublicationDaemonConfig } from '../dist/auth/publication-daemon-config.js'
import { startPublicationDaemon } from '../dist/auth/publication-daemon.js'

const report = (code) => process.stderr.write(code + '\n')
let requestedStop = false
let daemon
const shutdown = () => {
  requestedStop = true
  void daemon?.close().catch(() => {
    report('PUBLICATION_DAEMON_STOP')
    process.exitCode = 1
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
try {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--once'))
    throw new Error('PUBLICATION_DAEMON_ARGUMENTS')
  const config = await readPublicationDaemonConfig()
  daemon = await startPublicationDaemon(config, {
    once: args.includes('--once'),
    onError: report
  })
  if (requestedStop) await daemon.close()
} catch {
  report('PUBLICATION_DAEMON_FAILED')
  process.exitCode = 1
}
