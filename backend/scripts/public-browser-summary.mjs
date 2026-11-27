import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const root = process.argv[2]
if (!root) throw new Error('Specify an owned browser evidence directory')
const value = JSON.parse(await readFile(join(root, 'result.json'), 'utf8'))
// No bodies, authorization, downloaded files, URLs, signatures or restoration materials.
const summary = { status: value.status, startedAt: value.startedAt,
  finishedAt: value.finishedAt, sepolia: value.sepolia,
  independentProviders: value.independentProviders,
  allAcceptanceGroupsPassed: value.allAcceptanceGroupsPassed,
  orders: value.orders?.length, transactions: value.transactions?.length,
  identityChecks: value.identity?.length, applicationRequests: value.serverRequests?.length,
  proxyRequests: value.proxyRequests?.length,
  proxyRetryStatus: value.proxyRetry?.status }
await mkdir(join(root, 'public'), { recursive: true })
await writeFile(join(root, 'public', 'result-summary.json'), JSON.stringify(summary, null, 2) + '\n')
