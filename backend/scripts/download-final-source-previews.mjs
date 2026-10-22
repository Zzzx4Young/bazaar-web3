import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { URLSearchParams } from 'node:url'

const root = resolve(import.meta.dirname, '../../images/catalog-review')
const plan = JSON.parse(await readFile(resolve(root, 'catalog-plan.json'), 'utf8'))
const prior = JSON.parse(await readFile(resolve(root, 'sources.json'), 'utf8'))
const sources = new Map(prior.map((row) => [row.id, row]))
const hashes = new Set(prior.map((row) => row.sha256))
const choices = {
  'inventory dashboard screenshot': ['File:Erpnext-head-screenshot.jpg'],
  'calendar application screenshot': ['File:Nextcloud 30.0.13 - Appointments - Wikimedia CH.png'],
  'helpdesk dashboard screenshot': [
    'File:Zammad-dashboard.png',
    'File:Ticket zoom with text module.png',
    'File:Otrs-2.0.4-queueview.png'
  ]
}

async function get(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'BazaarWeb3CatalogReview/1.0 (local review)' },
    signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${new URL(url).host}`)
  return response
}

async function save(row, { url, sourcePage, sourceFile, author, license, licenseUrl }) {
  const response = await get(url)
  const bytes = Buffer.from(await response.arrayBuffer())
  const mime = response.headers.get('content-type')?.split(';')[0]
  const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : null
  if (!ext || bytes.length < 1000 || bytes.length > 5 * 1024 * 1024) throw new Error('Invalid image type or size')
  const valid = ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : bytes[0] === 0xff && bytes[1] === 0xd8
  if (!valid) throw new Error('Invalid image signature')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (hashes.has(sha256)) throw new Error('Duplicate image')
  const file = `assets/${row.id}.${ext}`
  await writeFile(resolve(root, file), bytes)
  sources.set(row.id, { id: row.id, title: row.product.title, category: row.category,
    publicationStatus: row.publicationStatus, imageQuery: row.product.imageQuery,
    file, sha256, byteSize: bytes.length, mime, sourcePage, sourceFile,
    sourceImageUrl: url, author, license, licenseUrl })
  hashes.add(sha256)
}

const titles = Object.values(choices).flat()
const params = new URLSearchParams({ action: 'query', format: 'json', titles: titles.join('|'),
  prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '800' })
const payload = await (await get(`https://commons.wikimedia.org/w/api.php?${params}`)).json()
const files = new Map(Object.values(payload.query?.pages ?? {}).map((page) => [page.title, page]))
for (const [query, names] of Object.entries(choices)) {
  const rows = plan.filter((row) => !row.locked && row.product.imageQuery === query && !sources.has(row.id))
  for (const [index, row] of rows.entries()) {
    const page = files.get(names[index])
    const info = page?.imageinfo?.[0]
    if (!info?.thumburl) continue
    const metadata = info.extmetadata ?? {}
    try {
      await save(row, { url: info.thumburl, sourcePage: info.descriptionurl,
        sourceFile: page.title, author: metadata.Artist?.value ?? '',
        license: metadata.LicenseShortName?.value ?? 'See source file page',
        licenseUrl: metadata.LicenseUrl?.value ?? info.descriptionurl })
    } catch (error) { console.error(`${page.title}: ${error.message}`) }
  }
}

const portfolio = plan.filter((row) => !row.locked &&
  row.product.imageQuery === 'portfolio website screenshot' && !sources.has(row.id))
const previews = [
  { project: 'codewithsadee/pfolio', path: 'readme-images/desktop.png' },
  { project: 'codewithsadee/vcard-personal-portfolio', path: 'website-demo-image/desktop.png' }
]
for (const [index, row] of portfolio.entries()) {
  const entry = previews[index]
  if (!entry) continue
  const url = `https://raw.githubusercontent.com/${entry.project}/master/${entry.path}`
  try {
    const license = await (await get(`https://raw.githubusercontent.com/${entry.project}/master/LICENSE`)).text()
    if (!license.startsWith('MIT License')) throw new Error('Project license changed')
    await save(row, { url, sourcePage: `https://github.com/${entry.project}`,
      sourceFile: `${entry.project}: ${entry.path}`, author: entry.project.split('/')[0],
      license: 'Repository code: MIT; screenshot media: verify before publication',
      licenseUrl: `https://github.com/${entry.project}/blob/master/LICENSE` })
  } catch (error) { console.error(`${entry.project}: ${error.message}`) }
}
await writeFile(resolve(root, 'sources.json'), JSON.stringify([...sources.values()], null, 2) + '\n')
console.log(JSON.stringify({ requested: 7, downloaded: sources.size - prior.length }))
