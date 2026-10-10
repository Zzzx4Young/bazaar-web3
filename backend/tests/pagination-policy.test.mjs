import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

async function policy(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
  return import(`data:text/javascript,${encodeURIComponent(compiled)}`)
}

test('pagination limits agree across backend, frontend and numeric OpenAPI parameters', async () => {
  const backend = await policy('../src/common/pagination-policy.ts')
  const frontend = await policy('../../frontend/src/lib/pagination.ts')
  assert.deepEqual(frontend.paginationPolicy, backend.paginationPolicy)
  assert.equal(frontend.PUBLIC_LISTINGS_PAGE_SIZE, backend.paginationPolicy.defaultLimit)
  assert.ok(frontend.EXPLORE_PAGE_SIZE <= backend.paginationPolicy.maxLimit)
  const api = JSON.parse(await readFile(new URL('../openapi/alpha.json', import.meta.url), 'utf8'))
  let checked = 0
  for (const item of Object.values(api.paths)) {
    for (const operation of Object.values(item)) {
      for (const parameter of operation?.parameters ?? []) {
        if (parameter.in !== 'query' || parameter.schema?.type !== 'integer') continue
        if (parameter.name === 'page') {
          assert.equal(parameter.schema.maximum, backend.paginationPolicy.maxPage)
          assert.equal(parameter.schema.default, backend.paginationPolicy.firstPage)
          checked++
        }
        if (parameter.name === 'limit') {
          assert.equal(parameter.schema.maximum, backend.paginationPolicy.maxLimit)
          assert.equal(parameter.schema.default, backend.paginationPolicy.defaultLimit)
          checked++
        }
      }
    }
  }
  assert.ok(checked > 0, 'No pagination contract was validated')
})
