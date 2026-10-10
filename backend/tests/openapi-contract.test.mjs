import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { categoryTypes } from '../dist/listings/categories.js'
import { cartMinItems, cartMaxItems } from '../dist/orders/cart-policy.js'
import { favoritesMaxIds } from '../dist/listings/favorites-policy.js'
import { listingTextPolicy } from '../dist/listings/listing-policy.js'
import { orderTextPolicy } from '../dist/orders/order-text-policy.js'
import { credentialInputPolicy } from '../dist/auth/auth-policy.js'
import { idempotencyKeyPolicy } from '../dist/orders/idempotency-key.js'

const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])

test('all idempotency header contracts enforce the shared key alphabet and length', async () => {
  const api = JSON.parse(await readFile(new URL('../openapi/alpha.json', import.meta.url), 'utf8'))
  let checked = 0
  for (const path of Object.values(api.paths)) {
    for (const [method, operation] of Object.entries(path)) {
      if (!methods.has(method)) continue
      for (const parameter of operation.parameters ?? []) {
        const resolved = parameter.$ref
          ? api.components.parameters[parameter.$ref.split('/').at(-1)] : parameter
        if (resolved.name.toLowerCase() !== 'idempotency-key') continue
        checked++
        assert.equal(resolved.required, true)
        const pattern = new RegExp(resolved.schema.pattern)
        assert.equal(pattern.test('a'.repeat(idempotencyKeyPolicy.minLength)), true)
        assert.equal(pattern.test('a'.repeat(idempotencyKeyPolicy.maxLength)), true)
        for (const value of ['', 'a'.repeat(idempotencyKeyPolicy.maxLength + 1), 'a b', 'a/b', '😀'])
          assert.equal(pattern.test(value), false)
      }
    }
  }
  assert.ok(checked > 0)
})

test('login contract matches credential input limits', async () => {
  const api = JSON.parse(await readFile(new URL('../openapi/alpha.json', import.meta.url), 'utf8'))
  const properties = api.components.schemas.Login.properties
  assert.equal(properties.loginName.minLength, credentialInputPolicy.loginMinLength)
  assert.equal(properties.loginName.maxLength, credentialInputPolicy.loginMaxLength)
  assert.equal(properties.password.minLength, credentialInputPolicy.passwordMinLength)
  assert.equal(properties.password.maxLength, credentialInputPolicy.passwordMaxLength)
})

test('shipping, delivery and issue text limits match OpenAPI', async () => {
  const api = JSON.parse(await readFile(new URL('../openapi/alpha.json', import.meta.url), 'utf8'))
  const schemas = api.components.schemas
  for (const field of ['recipient', 'contact', 'address'])
    assert.equal(schemas.Shipping.properties[field].maxLength, orderTextPolicy[`${field}MaxLength`])
  const [physical, digital] = schemas.DeliveryInput.oneOf
  assert.equal(physical.properties.carrier.maxLength, orderTextPolicy.carrierMaxLength)
  assert.equal(physical.properties.trackingNumber.maxLength, orderTextPolicy.trackingNumberMaxLength)
  assert.equal(digital.properties.url.maxLength, orderTextPolicy.deliveryUrlMaxLength)
  assert.equal(digital.properties.accessCode.maxLength, orderTextPolicy.accessCodeMaxLength)
  assert.equal(schemas.IssueInput.properties.description.maxLength, orderTextPolicy.issueDescriptionMaxLength)
})

test('listing text limits agree across backend, frontend and create contracts', async () => {
  const api = JSON.parse(await readFile(new URL('../openapi/alpha.json', import.meta.url), 'utf8'))
  const source = await readFile(new URL('../../frontend/src/lib/listing-policy.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const frontend = await import(`data:text/javascript,${encodeURIComponent(compiled)}`)
  assert.deepEqual(frontend.listingTextPolicy, listingTextPolicy)
  for (const name of ['PhysicalListingCreate', 'DigitalListingCreate']) {
    const properties = api.components.schemas[name].properties
    assert.equal(properties.title.maxLength, listingTextPolicy.titleMaxLength)
    assert.equal(properties.description.maxLength, listingTextPolicy.descriptionMaxLength)
  }
  const digital = api.components.schemas.DigitalListingCreate.properties
  assert.equal(digital.licenseDescription.maxLength, listingTextPolicy.licenseDescriptionMaxLength)
  assert.equal(digital.contentVersion.maxLength, listingTextPolicy.contentVersionMaxLength)
  assert.equal(api.components.schemas.ListingSearchInput.properties.keyword.maxLength,
    listingTextPolicy.keywordMaxLength)
  assert.equal(api.components.schemas.OwnListingSearchInput.properties.keyword.maxLength,
    listingTextPolicy.keywordMaxLength)
  assert.equal(api.components.schemas.ListingPatch.properties.title.maxLength,
    listingTextPolicy.titleMaxLength)
})

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
