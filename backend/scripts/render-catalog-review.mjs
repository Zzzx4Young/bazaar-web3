import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../images/catalog-review')
const plan = JSON.parse(await readFile(resolve(root, 'catalog-plan.json'), 'utf8'))
const sources = JSON.parse(await readFile(resolve(root, 'sources.json'), 'utf8'))
const images = new Map(sources.map((row) => [row.id, row]))
const targets = plan.filter((row) => !row.locked)
const categories = [...new Set(targets.map((row) => row.category))]
const escape = (value) => String(value ?? '').replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const summary = Object.fromEntries(categories.map((category) => [category, {
  total: targets.filter((row) => row.category === category).length,
  downloaded: targets.filter((row) => row.category === category && images.has(row.id)).length
}]))
const cards = targets.map((row) => {
  const image = images.get(row.id)
  return `<article data-category="${escape(row.category)}" data-status="${image ? 'ready' : 'missing'}">
    ${image ? `<img src="${escape(image.file)}" loading="lazy" alt="${escape(row.product.title)}">`
    : '<div class="missing">待补图</div>'}
    <h2>${escape(row.product.title)}</h2>
    <p class="meta">${escape(row.category)} · ${escape(row.publicationStatus)}</p>
    <p>${escape(row.product.description)}</p>
    ${image ? `<p class="source">${escape(image.sourceFile)}</p>
      <p class="meta">${escape(image.license)} · ${escape(image.author.replace(/<[^>]*>/g, ''))}</p>
      <a href="${escape(image.sourcePage)}" target="_blank" rel="noopener noreferrer">查看图片来源</a>
      ${image.licenseUrl ? `<a href="${escape(image.licenseUrl)}" target="_blank" rel="noopener noreferrer">查看许可</a>` : ''}` : ''}
    <small>${escape(row.id)}</small>
  </article>`
}).join('\n')
const options = categories.map((category) => `<option value="${escape(category)}">${escape(category)} (${summary[category].downloaded}/${summary[category].total})</option>`).join('')
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>商品图片审核</title><style>
*{box-sizing:border-box}body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f5f5f2;color:#1d2835}header{padding:24px max(20px,5vw);background:#fff;border-bottom:1px solid #ddd}h1{margin:0 0 10px}header p{max-width:850px;margin:6px 0}controls{display:block;margin-top:18px}select{padding:8px 12px;border:1px solid #bbb;border-radius:6px;background:white}main{padding:24px max(20px,5vw);display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px}article{min-width:0;background:#fff;border:1px solid #e1e1de;border-radius:10px;padding:14px}img,.missing{display:block;width:100%;height:230px;object-fit:contain;background:#ebeeed;border-radius:6px}.missing{display:grid;place-items:center;color:#87540d}h2{font-size:16px;line-height:1.4;margin:12px 0 4px}p{margin:6px 0;font-size:13px}.meta,small{color:#697582}.source{overflow-wrap:anywhere}a{display:inline-block;margin:5px 8px 0 0;color:#1456a6}small{display:block;margin-top:12px;font-size:10px;overflow-wrap:anywhere}
</style></head><body><header><h1>测试商品图片审核</h1><p>已找到 ${sources.length}/${targets.length} 张待审图；75 件已有订单的一次性商品未纳入。本目录保存来源与预览，上传状态以运行库为准。</p><p>实体照片及开源素材截图都是参考图，不代表实际二手商品或订单交付文件。请核对图片主体、许可和商品文字，再决定是否上传。</p><controls><label for="category">分类：</label><select id="category"><option value="all">全部 (${sources.length}/${targets.length})</option>${options}</select> <label for="status">状态：</label><select id="status"><option value="all">全部</option><option value="ready">已有图片</option><option value="missing">待补图</option></select></controls></header><main>${cards}</main><script>const filters=[document.querySelector('#category'),document.querySelector('#status')];function apply(){for(const card of document.querySelectorAll('article'))card.hidden=!(filters[0].value==='all'||filters[0].value===card.dataset.category)||!(filters[1].value==='all'||filters[1].value===card.dataset.status)}for(const filter of filters)filter.addEventListener('change',apply)</script></body></html>\n`
await writeFile(resolve(root, 'review.html'), html.split('\n').map((line) => line.trimEnd()).join('\n'))
await writeFile(resolve(root, 'remaining.json'), JSON.stringify(targets
  .filter((row) => !images.has(row.id))
  .map((row) => ({ id: row.id, title: row.product.title, category: row.category,
    publicationStatus: row.publicationStatus, imageQuery: row.product.imageQuery })), null, 2) + '\n')
console.log(JSON.stringify({ ...summary, total: targets.length, downloaded: sources.length,
  missing: targets.length - sources.length }))
