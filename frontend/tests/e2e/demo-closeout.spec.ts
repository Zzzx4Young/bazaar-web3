import { test, expect } from '@playwright/test'

test('leaving physical type clears the hidden condition', async ({ page }) => {
  await page.goto('/zh-CN/explore')
  const cards = page.locator('main a[href*="/listing/"]')
  await expect(cards).toHaveCount(25)
  await page.getByRole('combobox').nth(1).click()
  await page.getByRole('option', { name: '实物', exact: true }).click()
  await page.getByRole('combobox').nth(3).click()
  await page.getByRole('option', { name: '全新', exact: true }).click()
  await expect(cards).toHaveCount(0)
  await page.getByRole('combobox').nth(1).click()
  await page.getByRole('option', { name: '全部', exact: true }).click()
  await expect(cards).toHaveCount(25)
})

for (const locale of ['zh-CN', 'en']) {
  test(`mobile profile fits the screen in ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/${locale}/me`)
    await expect(page.getByRole('heading', { name: 'alice', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await expect(page.locator('main').getByRole('link', { name: '发布商品', exact: true })).toBeInViewport()
    // The previous fixed slice incorrectly showed another seller's clothes.
    await expect(page.locator('section').getByRole('link', { name: /Supreme|Air Jordan/ })).toHaveCount(0)
  })
}
