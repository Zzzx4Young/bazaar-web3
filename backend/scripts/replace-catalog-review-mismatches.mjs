import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { URLSearchParams } from 'node:url'

const root = resolve(import.meta.dirname, '../../images/catalog-review')
const archive = resolve(import.meta.dirname, '../.tmp/catalog-rejected')
const plan = JSON.parse(await readFile(resolve(root, 'catalog-plan.json'), 'utf8'))
const source = JSON.parse(await readFile(resolve(root, 'sources.json'), 'utf8'))
const products = new Map(plan.map((row) => [row.id, row.product]))
for (const row of source) {
  const product = products.get(row.id)
  if (product) {
    row.title = product.title
    row.imageQuery = product.imageQuery
  }
}

const docs = [
  { id: '45267d09-ea43-4128-8a05-95724940af85', page: 'https://docusaurus.io/docs' },
  { id: 'd4cc4cbd-289c-498b-8bd8-712c750e91b7', page: 'https://docusaurus.io/docs/create-doc' }
]
const replacements = []
for (const item of docs) {
  const file = `assets/${item.id}-docs.png`
  const bytes = await readFile(resolve(root, file))
  replacements.push({ id: item.id, file, bytes, sourcePage: item.page,
    sourceFile: `Docusaurus documentation: ${new URL(item.page).pathname}`,
    author: 'Docusaurus contributors; screenshot captured locally',
    license: 'Repository code: MIT; website screenshot media: verify before publication',
    licenseUrl: 'https://github.com/facebook/docusaurus/blob/main/LICENSE' })
}

const logoRow = source.find((row) => row.sourceFile === 'File:OpenProjectLogo.png')
if (!logoRow) throw new Error('OpenProject logo candidate not found')
const title = 'File:Openproject gantt.PNG'
const params = new URLSearchParams({ action: 'query', format: 'json', titles: title,
  prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '800' })
const api = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
  headers: { 'User-Agent': 'BazaarWeb3CatalogReview/1.0 (local review)' },
  signal: AbortSignal.timeout(30000) })
if (!api.ok) throw new Error(`Commons HTTP ${api.status}`)
const page = Object.values((await api.json()).query?.pages ?? {})[0]
const info = page?.imageinfo?.[0]
if (!info?.thumburl) throw new Error('OpenProject screenshot missing')
const response = await fetch(info.thumburl, { signal: AbortSignal.timeout(30000) })
if (!response.ok) throw new Error(`Screenshot HTTP ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
replacements.push({ id: logoRow.id, file: `assets/${logoRow.id}-gantt.png`, bytes,
  sourcePage: info.descriptionurl, sourceFile: title,
  author: info.extmetadata?.Artist?.value ?? '',
  license: info.extmetadata?.LicenseShortName?.value ?? 'See source file page',
  licenseUrl: info.extmetadata?.LicenseUrl?.value ?? info.descriptionurl })

await mkdir(archive, { recursive: true })
for (const item of replacements) {
  if (!item.bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    throw new Error(`Invalid PNG: ${item.id}`)
  const row = source.find((entry) => entry.id === item.id)
  if (!row) throw new Error(`Missing source entry: ${item.id}`)
  const oldFile = row.file
  if (oldFile !== item.file) await rename(resolve(root, oldFile),
    resolve(archive, `replaced-${item.id}-${oldFile.split('/').at(-1)}`))
  await writeFile(resolve(root, item.file), item.bytes)
  Object.assign(row, { file: item.file, mime: 'image/png', byteSize: item.bytes.length,
    sha256: createHash('sha256').update(item.bytes).digest('hex'),
    sourcePage: item.sourcePage, sourceFile: item.sourceFile, author: item.author,
    license: item.license, licenseUrl: item.licenseUrl, sourceImageUrl: item.sourcePage })
}
await writeFile(resolve(root, 'sources.json'), JSON.stringify(source, null, 2) + '\n')
console.log(JSON.stringify({ updatedMetadata: source.length, replacedImages: replacements.length }))
