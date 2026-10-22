import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { URLSearchParams } from 'node:url'

const root = resolve(import.meta.dirname, '../../images/catalog-review')
const assets = resolve(root, 'assets')
const plan = JSON.parse(await readFile(resolve(root, 'catalog-plan.json'), 'utf8'))
const physicalOnly = process.argv.includes('--physical-only')
const allProducts = plan.filter((row) => !row.locked &&
  (!physicalOnly || ['electronics', 'secondhand_fashion'].includes(row.category)))
const prior = process.argv.includes('--resume') || process.argv.includes('--repair')
  ? JSON.parse(await readFile(resolve(root, 'sources.json'), 'utf8')) : []
const preciseTerms = {
  'usb c docking station': { search: 'USB-C dock', title: /usb.c.*dock|dock.*usb.c/i, reject: /nvme|m\.2/i },
  'computer monitor 27 inch': { search: 'computer monitor', title: /monitor|computer display/i },
  'mirrorless digital camera': { search: 'mirrorless camera', title: /mirrorless.*camera|sony.a7/i, reject: /sensor|adapted lens/i },
  'camera prime lens': { search: 'camera lens', title: /lens/i, reject: /germinar|optical filter/i },
  'usb microphone desk': { search: 'USB microphone', title: /usb.*microphone|microphone.*usb/i },
  'ebook reader': { search: 'ebook reader', title: /e.?reader|ebook.reader|kobo|tolino/i, reject: /dictionary/i },
  'action camera': { search: 'action camera', title: /action.camera|gopro|drift.ghost/i, reject: /body.camera|police/i },
  'tablet computer': { search: 'tablet computer', title: /tablet|ipad/i, reject: /biscuits|windows.xp|stylistic.1000/i },
  'led ring light desk': { search: 'ring light', title: /ring.light|video.light|led.*light/i, reject: /light.painting|light.trail/i },
  'canvas backpack': { search: 'canvas backpack', title: /backpack/i, reject: /military/i },
  'computer speakers desk': { search: 'computer speakers', title: /computer.speaker|desktop.speaker|bookshelf.speaker/i },
  'portable projector': { search: 'portable projector', title: /portable.*projector|mini.*projector/i, reject: /crt|film/i },
  'leather crossbody bag': { search: 'leather shoulder bag', title: /crossbody|shoulder.bag|leather.handbag/i, reject: /garbage/i },
  'external solid state drive': { search: 'external SSD', title: /ssd|solid.state/i }
}
const manualCandidates = {
  'usb c docking station': [
    'File:Dell WD19 (model K20A)-5814.jpg',
    'File:Dell WD19 (model K20A)-5809.jpg'
  ],
  'computer speakers desk': [
    'File:Bose Computer MusicMonitor.jpg',
    'File:Creative T4 Wireless 2.1 Speakers.jpg',
    'File:Logitech computer loudspeakers.jpg',
    'File:Pc-speaker-systems.jpg',
    'File:Active speakers01.JPG',
    'File:Active speakers02.JPG'
  ],
  'portable projector': [
    'File:AAXATech P1 Pico Projector 2009.jpg',
    'File:Seeser front view.jpg'
  ]
}
const qualityIssues = prior.filter((row) => {
  const rule = preciseTerms[row.imageQuery]
  return rule && (!rule.title.test(row.sourceFile) || rule.reject?.test(row.sourceFile))
})
if (process.argv.includes('--repair'))
  await writeFile(resolve(root, 'quality-issues.json'), JSON.stringify(qualityIssues, null, 2) + '\n')
const excluded = new Set(process.argv.includes('--repair') ? qualityIssues.map((row) => row.id) : [])
const retained = prior.filter((row) => !excluded.has(row.id))
const source = new Map(retained.map((row) => [row.id, row]))
const usedTitles = new Set(retained.map((row) => row.sourceFile))
const products = allProducts.filter((row) => !source.has(row.id))
const groups = Map.groupBy(products, (row) => row.product.imageQuery)
const acceptedLicenses = /^(CC0|CC BY(?:-SA)?(?: 2\.0| 3\.0| 4\.0)?|Public domain)/i
const mimeExtensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const failed = []
await mkdir(assets, { recursive: true })

function coreTerm(query) {
  if (preciseTerms[query]) return preciseTerms[query].search
  if (query.includes('docking station')) return 'dock'
  const words = query.toLowerCase().split(/\s+/)
  return words.findLast((word) => !['desk', 'inch', 'digital', 'wireless', 'computer',
    'portable', 'vintage', 'canvas', 'leather', 'usb'].includes(word))
    ?.replace(/s$/, '') ?? words.at(-1)
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

async function fetchRetry(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'BazaarWeb3CatalogReview/1.0 (local image research)' },
        signal: AbortSignal.timeout(30000) })
      if (response.ok) return response
      if (response.status !== 429 && response.status < 500) break
    } catch (error) {
      if (attempt === attempts) throw error
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * attempt))
  }
  throw new Error(`Image source unavailable: ${new URL(url).host}`)
}

async function search(query) {
  const rule = preciseTerms[query]
  const term = rule ? null : coreTerm(query)
  const manual = manualCandidates[query]
  const params = new URLSearchParams({ action: 'query', format: 'json',
    ...(manual ? { titles: manual.join('|') } : {
      generator: 'search', gsrsearch: rule?.search ?? query,
      gsrnamespace: '6', gsrlimit: '50'
    }), prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '800' })
  const response = await fetchRetry(`https://commons.wikimedia.org/w/api.php?${params}`)
  const result = await response.json()
  return Object.values(result.query?.pages ?? {}).sort((a, b) =>
    manual ? manual.indexOf(a.title) - manual.indexOf(b.title) : a.index - b.index)
    .filter((page) => {
      const info = page.imageinfo?.[0]
      const license = info?.extmetadata?.LicenseShortName?.value ?? ''
      const name = page.title.toLowerCase()
      return mimeExtensions[info?.mime] && info.thumburl && acceptedLicenses.test(license) &&
        (manual || (rule ? rule.title.test(name) && !rule.reject?.test(name) : name.includes(term))) &&
        !/logo|poster|banner|advertis|screenshot|manual|diagram|brochure/.test(name)
    })
}

async function download(page, row) {
  const info = page.imageinfo[0]
  const response = await fetchRetry(info.thumburl)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length < 1000 || bytes.length > 5 * 1024 * 1024) throw new Error('Image size out of range')
  const mime = response.headers.get('content-type')?.split(';')[0] ?? info.mime
  const ext = mimeExtensions[mime]
  if (!ext) throw new Error('Unexpected image content type')
  const valid = ext === 'jpg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
    : ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  assert.ok(valid, 'Unexpected image bytes')
  const file = `${row.id}.${ext}`
  await writeFile(resolve(assets, file), bytes)
  return { id: row.id, title: row.product.title, category: row.category,
    publicationStatus: row.publicationStatus, imageQuery: row.product.imageQuery,
    file: `assets/${file}`, sha256: createHash('sha256').update(bytes).digest('hex'),
    byteSize: bytes.length, mime, sourcePage: info.descriptionurl,
    sourceFile: page.title, author: info.extmetadata?.Artist?.value ?? '',
    license: info.extmetadata?.LicenseShortName?.value ?? '',
    licenseUrl: info.extmetadata?.LicenseUrl?.value ?? '' }
}

for (const [query, rows] of groups) {
  const rule = preciseTerms[query]
  let candidates
  try {
    candidates = await search(query)
    if (!rule && candidates.length < rows.length) {
      const broad = coreTerm(query)
      candidates.push(...(await search(broad)).filter((page) =>
        !candidates.some((existing) => existing.pageid === page.pageid)))
    }
  } catch (error) {
    failed.push({ query, reason: error.message, count: rows.length })
    continue
  }
  for (const row of rows) {
    let found = false
    while (candidates.length) {
      const candidate = candidates.shift()
      if (usedTitles.has(candidate.title)) continue
      try {
        const entry = await download(candidate, row)
        usedTitles.add(candidate.title)
        source.set(row.id, entry)
        found = true
        break
      } catch { /* Try the next Commons file. */ }
    }
    if (!found) failed.push({ id: row.id, title: row.product.title, query })
  }
  console.log(JSON.stringify({ query, selected: rows.filter((row) => source.has(row.id)).length,
    requested: rows.length }))
  await writeFile(resolve(root, 'sources.json'), JSON.stringify([...source.values()], null, 2) + '\n')
}

const records = [...source.values()].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
const cards = records.map((row) => `<article><img src="${escapeHtml(row.file)}" loading="lazy" alt="${escapeHtml(row.title)}"><h2>${escapeHtml(row.title)}</h2><p>${escapeHtml(row.category)} · ${escapeHtml(row.publicationStatus)}</p><p>${escapeHtml(row.sourceFile)}</p><p>${escapeHtml(row.license)}</p><a href="${escapeHtml(row.sourcePage)}">查看原始文件和授权</a><small>${escapeHtml(row.id)}</small></article>`).join('\n')
await writeFile(resolve(root, 'review.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>商品图片审核</title><style>body{font:16px system-ui;margin:24px;background:#f5f5f5;color:#222}header{max-width:900px;margin:auto}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}article{padding:12px;background:white;border-radius:12px}img{width:100%;height:210px;object-fit:contain;background:#eee}h2{font-size:16px}p{font-size:13px}small{display:block;font-size:10px;color:#666;overflow-wrap:anywhere;margin-top:10px}</style><header><h1>商品图片待审核</h1><p>每张图仅作同类商品示意。请逐项确认主体是否符合商品标题；未经审核，不上传到 Garage。</p><p>已下载 ${records.length}/${allProducts.length} 张。授权和来源见每张卡片及 sources.json。</p></header><main>${cards}</main></html>\n`)
await writeFile(resolve(root, 'missing.json'), JSON.stringify(failed, null, 2) + '\n')
console.log(JSON.stringify({ requested: allProducts.length, downloaded: records.length,
  missing: failed.length, uniqueImages: new Set(records.map((row) => row.sha256)).size }))
if (records.length !== allProducts.length || new Set(records.map((row) => row.sha256)).size !== records.length)
  process.exitCode = 1
