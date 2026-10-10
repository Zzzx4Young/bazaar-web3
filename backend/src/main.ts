import { createApp } from './app.js'
import { readConfig } from './config.js'
import { DatabaseService } from './database/database.service.js'
import { startOrderExpiry } from './orders/order-expiry.js'
import { startAuthRateCleanup } from './auth/auth-rate-cleanup.js'

async function main() {
  const config = readConfig()
  const app = await createApp(config)
  try {
    await app.listen(config.port, config.host)
    const stopExpiry = startOrderExpiry(app.get(DatabaseService).client, {
      onError: () => console.error('Order expiry sweep failed')
    })
    const stopAuthCleanup = startAuthRateCleanup(app.get(DatabaseService).client, {
      onError: () => console.error('Auth rate cleanup failed')
    })
    process.once('SIGTERM', stopExpiry)
    process.once('SIGINT', stopExpiry)
    process.once('SIGTERM', stopAuthCleanup)
    process.once('SIGINT', stopAuthCleanup)
  } catch (error) {
    await app.close()
    throw error
  }
}

main().catch(() => {
  // Driver errors can contain connection details. Do not print raw startup errors.
  console.error('Backend startup failed; check configuration and database availability')
  process.exitCode = 1
})
