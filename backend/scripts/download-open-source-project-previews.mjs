import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../images/catalog-review')
const plan = JSON.parse(await readFile(resolve(root, 'catalog-plan.json'), 'utf8'))
const prior = JSON.parse(await readFile(resolve(root, 'sources.json'), 'utf8'))
const source = new Map(prior.map((row) => [row.id, row]))
const hashes = new Set(prior.map((row) => row.sha256))
const project = 'Kuzma02/Electronics-eCommerce-Shop-With-Admin-Dashboard-NextJS-NodeJS'
const readme = `https://raw.githubusercontent.com/${project}/main/README.md`
const repo = `https://github.com/${project}`
const groups = {
  'ecommerce user interface design': ['Home page', 'Shop page', 'Single product page', 'Search page', 'Cart page'],
  'online store website screenshot': ['Wishlist page', 'Checkout page', 'Register page'],
  'inventory dashboard screenshot': ['Admin dashboard - All products page', 'Admin dashboard - All categories page'],
  'dashboard user interface design': ['Admin dashboard - All orders page', 'Admin dashboard - All users page']
}

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'BazaarWeb3CatalogReview/1.0 (local review)' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${new URL(url).host}`)
  return response
}

const markdown = await (await get(readme)).text()
const license = await (await get(`https://raw.githubusercontent.com/${project}/main/LICENSE`)).text()
if (!license.startsWith('MIT License')) throw new Error('Project license changed')
const screenshots = new Map()
for (const match of markdown.matchAll(/<h3>([^<]+)<\/h3>\s*!\[[^\]]*\]\((https:\/\/github\.com\/[^)]+)\)/g))
  screenshots.set(match[1], match[2])

for (const [query, headings] of Object.entries(groups)) {
  const rows = plan.filter((row) => !row.locked && row.product.imageQuery === query && !source.has(row.id))
  for (const [index, row] of rows.entries()) {
    const heading = headings[index]
    const imageUrl = screenshots.get(heading)
    if (!imageUrl) continue
    try {
      const response = await get(imageUrl)
      const bytes = Buffer.from(await response.arrayBuffer())
      const mime = response.headers.get('content-type')?.split(';')[0]
      const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : null
      if (!ext || bytes.length < 1000 || bytes.length > 5 * 1024 * 1024) continue
      const valid = ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : bytes[0] === 0xff && bytes[1] === 0xd8
      if (!valid) continue
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (hashes.has(sha256)) continue
      const file = `assets/${row.id}.${ext}`
      await writeFile(resolve(root, file), bytes)
      source.set(row.id, { id: row.id, title: row.product.title, category: row.category,
        publicationStatus: row.publicationStatus, imageQuery: query, file, sha256,
        byteSize: bytes.length, mime, sourcePage: repo, sourceFile: `${heading} — project README`,
        sourceImageUrl: imageUrl, author: 'Aleksandar Kuzmanović et al.',
        license: 'Repository code: MIT; screenshot media: verify before publication',
        licenseUrl: `${repo}/blob/main/LICENSE` })
      hashes.add(sha256)
    } catch (error) { console.error(`${heading}: ${error.message}`) }
  }
  await writeFile(resolve(root, 'sources.json'), JSON.stringify([...source.values()], null, 2) + '\n')
  console.log(JSON.stringify({ query, ready: rows.filter((row) => source.has(row.id)).length,
    required: rows.length }))
}
