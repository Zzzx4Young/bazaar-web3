import { type Transaction } from '../database/transaction.js'

export async function lockMediaAssets(tx: Transaction, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$queryRaw`SELECT "id" FROM "MediaAsset" WHERE "id" = ${id}::uuid FOR UPDATE`
  }
}
