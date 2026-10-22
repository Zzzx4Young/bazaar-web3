import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const pages = {
  'game controller input icons': ['input-prompts', 'ui-pack-sci-fi', 'ui-pack-adventure', 'game-icons', 'game-icons-expansion'],
  'pixel art character sprites': ['roguelike-characters', '1-bit-platformer-pack', 'pixel-platformer', 'roguelike-rpg-pack', 'tiny-dungeon'],
  'isometric city illustration': ['isometric-tiles-city', 'city-kit-commercial', 'city-kit-suburban', 'city-kit-industrial'],
  'geometric abstract pattern': ['pattern-pack', 'pattern-pack-lines', 'pattern-pack-pixel', 'pattern-pack-extra', 'background-elements'],
  'pixel art game items': ['roguelike-rpg-pack', 'pixel-platformer'],
  'fantasy game map tiles': ['roguelike-caves-dungeons', 'tiny-dungeon'],
  'polyhedral dice': ['playing-cards-pack', 'board-game-icons'],
  'low poly treasure chest': ['mini-dungeon', 'modular-dungeon-kit'],
  'game status icons': ['game-icons', 'board-game-info', 'game-icons-expansion', 'ui-pack'],
  'arcade game buttons': ['pixel-ui-pack', 'game-icons-expansion'],
  'game forest background': ['background-elements-remastered', 'background-elements'],
  'pixel art spaceship': ['space-shooter-extension', 'space-shooter-remastered'],
  'fantasy card game design': ['fantasy-ui-borders', 'playing-cards-pack', 'board-game-icons'],
  'role playing game interface': ['ui-pack-rpg-expansion', 'ui-pack-adventure']
}

const root = resolve(import.meta.dirname, '../../images/catalog-review')
const plan = JSON.parse(await readFile(resolve(root, 'catalog-plan.json'), 'utf8'))
const prior = JSON.parse(await readFile(resolve(root, 'sources.json'), 'utf8'))
const source = new Map(prior.map((row) => [row.id, row]))
const hashes = new Set(prior.map((row) => row.sha256))
const usedImageUrls = new Set(prior.map((row) => row.sourceImageUrl).filter(Boolean))
const targets = plan.filter((row) => !row.locked && (row.category === 'game_items' ||
  (row.category === 'digital_assets' && pages[row.product.imageQuery])))
const groups = Map.groupBy(targets.filter((row) => !source.has(row.id)),
  (row) => row.product.imageQuery)
await mkdir(resolve(root, 'assets'), { recursive: true })

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'BazaarWeb3CatalogReview/1.0' },
        signal: AbortSignal.timeout(20000) })
      if (response.ok) return response
    } catch { /* Retry transient network errors. */ }
    await new Promise((done) => setTimeout(done, attempt * 500))
  }
  throw new Error(`Unavailable source: ${url}`)
}

async function previews(slug) {
  const sourcePage = `https://kenney.nl/assets/${slug}`
  const html = await (await get(sourcePage)).text()
  assert.match(html, /License[\s\S]{0,500}Creative Commons CC0/)
  const images = [...html.matchAll(/class=['"]screenshot[^'"]*['"]\s+href=['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
  const og = html.match(/property=['"]og:image['"]\s+content=['"]([^'"]+)['"]/)?.[1]
  if (og) images.push(og)
  return [...new Set(images)].map((url) => ({ url, sourcePage, slug }))
}

const failed = []
for (const [query, rows] of groups) {
  const candidates = []
  for (const slug of pages[query] ?? []) {
    try { candidates.push(...(await previews(slug)).filter((item) => !usedImageUrls.has(item.url))) }
    catch (error) { failed.push({ query, slug, reason: error.message }) }
    if (candidates.length >= rows.length + 1) break
  }
  for (const row of rows) {
    let saved = false
    while (candidates.length) {
      const candidate = candidates.shift()
      try {
        const response = await get(candidate.url)
        const bytes = Buffer.from(await response.arrayBuffer())
        const mime = response.headers.get('content-type')?.split(';')[0]
        const extension = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : null
        assert.ok(extension && bytes.length >= 1000 && bytes.length <= 5 * 1024 * 1024)
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        if (hashes.has(sha256)) continue
        const file = `assets/${row.id}.${extension}`
        await writeFile(resolve(root, file), bytes)
        source.set(row.id, { id: row.id, title: row.product.title, category: row.category,
          publicationStatus: row.publicationStatus, imageQuery: query, file,
          sha256, byteSize: bytes.length, mime, sourcePage: candidate.sourcePage,
          sourceFile: `Kenney ${candidate.slug}: ${candidate.url.split('/').at(-1)}`,
          sourceImageUrl: candidate.url, author: 'Kenney', license: 'CC0 1.0',
          licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' })
        hashes.add(sha256)
        usedImageUrls.add(candidate.url)
        saved = true
        break
      } catch { /* Skip broken preview and try the next one. */ }
    }
    if (!saved) failed.push({ id: row.id, title: row.product.title, query })
  }
  await writeFile(resolve(root, 'sources.json'), JSON.stringify([...source.values()], null, 2) + '\n')
  console.log(JSON.stringify({ query, found: rows.filter((row) => source.has(row.id)).length,
    required: rows.length }))
}

await writeFile(resolve(root, 'game-missing.json'), JSON.stringify(failed, null, 2) + '\n')
console.log(JSON.stringify({ gameTargets: targets.length,
  gameImages: targets.filter((row) => source.has(row.id)).length, failures: failed.length }))
if (targets.some((row) => !source.has(row.id))) process.exitCode = 1
