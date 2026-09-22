import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])

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
