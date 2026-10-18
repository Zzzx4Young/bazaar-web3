import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { URLSearchParams } from 'node:url'

// Wikimedia Commons file pages are the provenance records for this test catalog.
const sources = {
  electronics: ['Laptop image.jpg', 'Circuit-board-1.jpg'],
  secondhand_fashion: ['Clothing Rack of Jeans.jpg', 'Pantalones jeans (versión 4).jpg'],
  game_items: ['Game Controllers.jpg', 'Titans Sphere - 29838437925.jpg'],
  software_source: ['Programming.jpg', 'Debug.jpg'],
  digital_assets: ['Abstract 01 (Unsplash).jpg', 'January by Roxana Radulescu 2016.jpg']
}
const output = resolve(import.meta.dirname, '../../images')
const maxBytes = 5 * 1024 * 1024

function plainText(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()
}

async function fetchWithRetry(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (response.ok) return response
      if (response.status < 500 && response.status !== 429) throw new Error(`HTTP ${response.status}`)
    } catch (error) {
      if (attempt === 3) throw error
    }
    await new Promise((done) => setTimeout(done, (attempt + 1) * 1000))
  }
  throw new Error('Remote server unavailable')
}

async function download(category, position, title) {
  const query = new URLSearchParams({
    action: 'query', prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '900',
    format: 'json', titles: `File:${title}`
  })
  const response = await fetchWithRetry(`https://commons.wikimedia.org/w/api.php?${query}`)
  const page = Object.values((await response.json()).query.pages)[0]
  const info = page?.imageinfo?.[0]
  const license = info?.extmetadata?.LicenseShortName?.value
  if (!info || page.missing || info.mime !== 'image/jpeg' || info.size > maxBytes ||
    !/^CC0(?:\s|$)/i.test(license ?? ''))
    throw new Error(`Image is missing, not JPEG/CC0, or too large: ${title} (${license ?? '?'})`)
  const imageResponse = await fetchWithRetry(info.thumburl ?? info.url)
  const bytes = Buffer.from(await imageResponse.arrayBuffer())
  if (bytes.length < 1000 || bytes.length > maxBytes ||
    imageResponse.headers.get('content-type')?.split(';')[0] !== 'image/jpeg' ||
    (info.thumbsize && bytes.length !== info.thumbsize) ||
    bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9)
    throw new Error(`Image integrity check failed: ${title}`)
  const filename = `${category}-${position + 1}.jpg`
  await writeFile(resolve(output, filename), bytes)
  return {
    category, position, filename, title: page.title, source: info.descriptionurl,
    author: plainText(info.extmetadata.Artist?.value ?? ''), license,
    licenseUrl: info.extmetadata.LicenseUrl?.value ?? 'https://creativecommons.org/publicdomain/zero/1.0/',
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')
  }
}

await mkdir(output, { recursive: true })
const manifestPath = resolve(output, 'sources.json')
const manifest = await readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => [])
for (const [category, titles] of Object.entries(sources)) {
  for (const [position, title] of titles.entries()) {
    const existing = manifest.find((row) => row.category === category && row.position === position)
    if (existing) {
      const bytes = await readFile(resolve(output, existing.filename))
      if (createHash('sha256').update(bytes).digest('hex') === existing.sha256) continue
      throw new Error(`Existing image changed: ${existing.filename}`)
    }
    const item = await download(category, position, title)
    manifest.push(item)
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    console.log(`${item.filename}: ${item.bytes} bytes, ${item.license}`)
  }
}
