import { readFileSync } from 'node:fs'
import { DatabaseService } from '../dist/database/database.service.js'
import { V2_SEED_PREFIX, assertLoopbackDatabaseUrl } from './v2-seed.mjs'

const url = process.env.DATABASE_URL ?? readFileSync(process.env.DATABASE_URL_FILE, 'utf8').trim()
assertLoopbackDatabaseUrl(url)
const apply = process.argv.includes('--apply')
const db = new DatabaseService(url)
const categoryType = {
  electronics: 'physical', secondhand_fashion: 'physical',
  digital_assets: 'digital', software_source: 'digital', game_items: 'digital'
}
await db.onModuleInit()
try {
  const listings = await db.client.listing.findMany({
    where: { OR: [
      { listingSeller: { loginName: { startsWith: `${V2_SEED_PREFIX}_seller_` } } },
      { title: { startsWith: 'V2 ' } },
      { title: { startsWith: '超长中文标题 ' } },
      { title: { startsWith: 'Zero price free sample' } }
    ] },
    include: { listingSeller: { select: { loginName: true } } }
  })
  const v2Title = (title) => /^V2 (physical|digital) listing \d{3} · [a-z_]+$/.test(title)
  const v2SellerIds = new Set(listings.filter((listing) => v2Title(listing.title))
    .map((listing) => listing.sellerId))
  const scoped = listings.filter((listing) =>
    listing.listingSeller.loginName.startsWith(`${V2_SEED_PREFIX}_seller_`) ||
    v2Title(listing.title) ||
    (v2SellerIds.has(listing.sellerId) &&
      (listing.title.startsWith('超长中文标题 ') ||
        listing.title.startsWith('Zero price free sample'))))
  const mismatches = scoped.filter((listing) => categoryType[listing.category] !== listing.type)
  if (apply) {
    for (const listing of mismatches) {
      const category = listing.type === 'physical' ? 'electronics' : 'digital_assets'
      const title = listing.title.endsWith(` · ${listing.category}`)
        ? listing.title.slice(0, -listing.category.length) + category
        : listing.title
      await db.client.listing.update({ where: { id: listing.id }, data: { category, title } })
    }
  }
  console.log(JSON.stringify({ scope: 'V2 test listings', listings: scoped.length,
    mismatches: mismatches.length, updated: apply ? mismatches.length : 0 }))
} finally {
  await db.onModuleDestroy()
}
