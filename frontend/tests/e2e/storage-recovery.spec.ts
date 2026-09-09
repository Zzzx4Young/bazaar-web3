import { test, expect } from '@playwright/test'

test('failed order save can be retried and survives reload exactly once', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/zh-CN/listing/item_001')
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'c2c:orders' && !sessionStorage.getItem('allow-order-save')) {
        throw new DOMException('test quota failure', 'QuotaExceededError')
      }
      original.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: '立即购买' }).click()
  await page.getByRole('button', { name: '确认下单' }).click()
  await expect(page.getByRole('alert')).toContainText('订单未保存')
  expect(await page.evaluate(() => localStorage.getItem('c2c:orders'))).toBeNull()
  await page.evaluate(() => sessionStorage.setItem('allow-order-save', '1'))
  await page.getByRole('button', { name: '确认下单' }).click()
  await expect(page.getByText('下单成功 ✓')).toBeVisible()
  await page.getByRole('button', { name: '查看订单' }).click()
  await expect(page).toHaveURL(/\/zh-CN\/me$/)
  await page.reload()
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('c2c:orders')!).state.userOrders.length
    )
  ).toBe(1)
  await expect(
    page
      .getByRole('tabpanel')
      .getByRole('link', { name: /iPhone 15 Pro/ })
      .filter({ hasText: 'iPhone 15 Pro' }).first()
  ).toBeVisible()
  expect(errors).toEqual([])
})

test('corrupt product entries do not crash grids, favorites or detail after reload', async ({
  page
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/zh-CN')
  await page.evaluate(() => {
    localStorage.setItem(
      'c2c:items:user-published',
      JSON.stringify([
        {},
        null,
        {
          id: 'item_user_cache_test',
          sellerId: 'seller_001',
          title: 'Recovered cache product',
          description: 'valid legacy entry',
          category: 'physical',
          tags: [],
          price: { amount: 10, currency: 'CNY' },
          media: [],
          status: 'active',
          viewCount: 0,
          favoriteCount: 0,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z'
        }
      ])
    )
    localStorage.setItem('c2c:user:favorites', JSON.stringify(['item_user_cache_test']))
  })
  for (const route of ['/zh-CN/explore', '/zh-CN/favorites', '/zh-CN/seller/seller_001']) {
    await page.goto(route)
    await expect(page.getByRole('link', { name: /Recovered cache product/ }).first()).toBeVisible()
  }
  await page.goto('/zh-CN/listing/item_user_cache_test')
  await expect(page.locator('h1')).toHaveText('Recovered cache product')
  await page.reload()
  await expect(page.locator('h1')).toHaveText('Recovered cache product')
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('c2c:items:user-published')!).length)
  ).toBe(3)
  expect(errors).toEqual([])
})
