import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { categoryTypes } from '../dist/listings/categories.js'
import { cartMinItems, cartMaxItems } from '../dist/orders/cart-policy.js'
import { favoritesMaxIds } from '../dist/listings/favorites-policy.js'

const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])

test('favorite batch limits agree across frontend, backend and OpenAPI', async () => {
  const api = JSON.parse(await readFile(new URL('../openapi/alpha.json', import.meta.url), 'utf8'))
  assert.equal(api.paths['/listings/favorites/resolve'].post.requestBody.content['application/json']
    .schema.properties.ids.maxItems, favoritesMaxIds)
  const source = await readFile(new URL('../../frontend/src/lib/favorites-policy.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const frontend = await import(`data:text/javascript,${encodeURIComponent(compiled)}`)
  assert.equal(frontend.favoritesMaxIds, favoritesMaxIds)
})

test('cart limits agree across runtime policies and request/response contracts', async () => {
  const api = JSON.parse(await readFile(new URL('../openapi/alpha.json', import.meta.url), 'utf8'))
  for (const schema of [api.components.schemas.CheckoutCreate.properties.items,
    api.components.schemas.CheckoutCreateResult.properties.orderIds]) {
    assert.equal(schema.minItems, cartMinItems)
    assert.equal(schema.maxItems, cartMaxItems)
  }
  const source = await readFile(new URL('../../frontend/src/lib/cart-policy.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const frontend = await import(`data:text/javascript,${encodeURIComponent(compiled)}`)
  assert.equal(frontend.cartMinItems, cartMinItems)
  assert.equal(frontend.cartMaxItems, cartMaxItems)
})

test('OpenAPI declares path parameters and request correlation on every operation', async () => {
  const api = JSON.parse(
    await readFile(new URL('../openapi/alpha.json', import.meta.url), 'utf8')
  )

  for (const [path, item] of Object.entries(api.paths)) {
    const operations = Object.entries(item).filter(([key]) => methods.has(key))
    assert.ok(operations.length > 0, `${path} must contain an operation`)

    const pathParameters = item.parameters ?? []
    for (const name of Array.from(path.matchAll(/\{([^}]+)\}/g), (match) => match[1])) {
      assert.ok(
        pathParameters.some(
          (parameter) =>
            parameter.name === name && parameter.in === 'path' && parameter.required === true
        ),
        `${path} must declare required path parameter ${name}`
      )
    }
    assert.ok(
      pathParameters.some(
        (parameter) => parameter.$ref === '#/components/parameters/RequestId'
      ),
      `${path} must accept X-Request-Id`
    )

    for (const [method, operation] of operations) {
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        assert.equal(
          response.headers?.['X-Request-Id']?.$ref,
          '#/components/headers/RequestId',
          `${method.toUpperCase()} ${path} response ${status} must return X-Request-Id`
        )
      }
    }
  }
  for (const [path, schema] of [
    ['/listings/search', 'ListingSearchInput'],
    ['/me/listings', 'OwnListingSearchInput']
  ]) {
    assert.equal(api.paths[path].post.requestBody.content['application/json'].schema.$ref,
      `#/components/schemas/${schema}`)
    assert.equal(api.paths[path].post.parameters?.some((item) => item.in === 'query') ?? false, false)
  }
})

test('create category contract matches backend validation and frontend options', async () => {
  const api = JSON.parse(await readFile(new URL('../openapi/alpha.json', import.meta.url), 'utf8'))
  const physical = api.components.schemas.PhysicalListingCreate.properties.category.enum
  const digital = api.components.schemas.DigitalListingCreate.properties.category.enum
  assert.deepEqual(Object.entries(categoryTypes).sort(), [
    ...physical.map((category) => [category, 'physical']),
    ...digital.map((category) => [category, 'digital'])
  ].sort())

  const source = await readFile(new URL('../../frontend/src/lib/categories.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const { marketplaceCategories } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`)
  assert.deepEqual(marketplaceCategories.map(({ id, itemCategory }) => [id, itemCategory]).sort(),
    Object.entries(categoryTypes).sort())
})
