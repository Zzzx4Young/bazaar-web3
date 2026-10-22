import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { URLSearchParams } from 'node:url'

const root = resolve(import.meta.dirname, '../../images/catalog-review')
const plan = JSON.parse(await readFile(resolve(root, 'catalog-plan.json'), 'utf8'))
const sources = JSON.parse(await readFile(resolve(root, 'sources.json'), 'utf8'))
const existing = new Map(sources.map((entry) => [entry.id, entry]))
const hashes = new Set(sources.map((entry) => entry.sha256))
const categories = {
  'botanical illustration': { name: 'Botanical_illustrations', match: /botanical|flora|flower|plant|fleur|fruit|leaf|garden/i },
  'nature landscape wallpaper': { name: 'Landscape_photography', match: /mountain|landscape|lake|forest|valley|peak|river|sunset|nature|alps/i },
  'travel map infographic': { name: 'Tourist_maps', match: /map|carte|guide|itinerary|tourist|travel/i },
  'task management app screenshot': { name: 'OpenProject', match: /openproject|gantt/i },
  'calendar application screenshot': { name: 'Screenshots_of_GNOME_Calendar', match: /calendar|agenda.de.gnome/i },
  'documentation website screenshot': { name: 'MediaWiki_screenshots', match: /mediawiki|wiki|visual.editor/i },
  'analytics dashboard screenshot': { name: 'Grafana', match: /grafana.*dashboard|grafana.*screenshot/i },
  'blog editor screenshot': { name: 'WordPress_screenshots', match: /wordpress|editor|blog/i },
  'learning dashboard screenshot': { name: 'Moodle', match: /moodle|myhome/i },
  'information graphics charts': { name: 'Statistical_charts', match: /chart|graph|plot|statistics|rate/i },
  'vintage poster typography': { name: '1900s_posters', match: /poster|advertis|affiche|plakat/i },
  'restaurant menu design': { name: 'Food_menus', match: /menu|carte|bill.of.fare/i },
  'abstract gradient background': { name: 'Color_gradient', match: /gradient|background/i },
  'versatile background images': { name: 'Background_images', match: /background|backdrop|texture/i },
  'dashboard user interface design': { name: 'Dashboards_(computing)', match: /dashboard|analytics|report|portal/i },
  'social media infographic': { name: 'Information_graphics_about_social_media', match: /social.media|social.network|B2B.vs.B2C/i }
}
const licensePattern = /^(CC0|CC BY(?:-SA)?(?: 2\.0| 3\.0| 4\.0)?|Public domain)/i
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

async function get(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'BazaarWeb3CatalogReview/1.0 (local review)' },
    signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response
}

for (const [query, category] of Object.entries(categories)) {
  const rows = plan.filter((row) => !row.locked && row.product.imageQuery === query && !existing.has(row.id))
  if (!rows.length) continue
  const candidates = []
  let continuation = {}
  for (let page = 0; page < 4 && candidates.length < rows.length * 4; page++) {
    const params = new URLSearchParams({ action: 'query', format: 'json', generator: 'categorymembers',
      gcmtitle: `Category:${category.name}`, gcmtype: 'file', gcmlimit: '100',
      prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '800', ...continuation })
    const result = await (await get(`https://commons.wikimedia.org/w/api.php?${params}`)).json()
    for (const item of Object.values(result.query?.pages ?? {})) {
      const info = item.imageinfo?.[0]
      if (!category.match.test(item.title) || !info?.thumburl || !extensions[info.mime] ||
        !licensePattern.test(info.extmetadata?.LicenseShortName?.value ?? '')) continue
      candidates.push({ title: item.title, info })
    }
    if (!result.continue?.gcmcontinue) break
    continuation = { gcmcontinue: result.continue.gcmcontinue, continue: result.continue.continue }
  }
  for (const row of rows) {
    while (candidates.length) {
      const candidate = candidates.shift()
      try {
        const response = await get(candidate.info.thumburl)
        const bytes = Buffer.from(await response.arrayBuffer())
        const mime = response.headers.get('content-type')?.split(';')[0]
        const ext = extensions[mime]
        if (!ext || bytes.length < 1000 || bytes.length > 5 * 1024 * 1024) continue
        const signature = ext === 'jpg' ? bytes[0] === 0xff && bytes[1] === 0xd8
          : ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
            : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        assert.ok(signature, 'Invalid image signature')
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        if (hashes.has(sha256)) continue
        const file = `assets/${row.id}.${ext}`
        await writeFile(resolve(root, file), bytes)
        const meta = candidate.info.extmetadata
        existing.set(row.id, { id: row.id, title: row.product.title, category: row.category,
          publicationStatus: row.publicationStatus, imageQuery: query, file, sha256,
          byteSize: bytes.length, mime, sourcePage: candidate.info.descriptionurl,
          sourceFile: candidate.title, author: meta.Artist?.value ?? '',
          license: meta.LicenseShortName?.value ?? '', licenseUrl: meta.LicenseUrl?.value ?? '' })
        hashes.add(sha256)
        break
      } catch (error) { console.error(`${query}: ${error.message}`) }
    }
  }
  await writeFile(resolve(root, 'sources.json'), JSON.stringify([...existing.values()], null, 2) + '\n')
  console.log(JSON.stringify({ query, ready: rows.filter((row) => existing.has(row.id)).length,
    required: rows.length }))
}
