import { test, expect } from '@playwright/test'

test.describe('home page', () => {
  test('renders the title', async ({ page }) => {
    await page.goto('/zh-CN')
    await expect(page).toHaveTitle(/Bazaar Web3/)
  })

  test('shows hero banner', async ({ page }) => {
    await page.goto('/zh-CN')
    await expect(page.locator('h2').first()).toBeVisible()
  })

  test('shows category tabs', async ({ page }) => {
    await page.goto('/zh-CN')
    // categories are shown as links (Link from next-intl)
    const tabs = page.getByRole('link', { name: /全部|电子数码|数字资产|软件源码|游戏道具|二手服饰/ })
    await expect(tabs.first()).toBeVisible()
  })

  test('shows item grid with cards', async ({ page }) => {
    await page.goto('/zh-CN')
    const itemCards = page.locator('a[href^="/listing/"]')
    await expect(itemCards.first()).toBeVisible()
  })
})

test.describe('language switch', () => {
  test('home page renders in zh-CN', async ({ page }) => {
    await page.goto('/zh-CN')
    await page.waitForLoadState('domcontentloaded')
    await expect(page).toHaveTitle(/Bazaar Web3/)
  })

  test('switching to /en renders English nav', async ({ page }) => {
    await page.goto('/zh-CN')
    const switcher = page.getByRole('button', { name: /Switch language|语言/ })
    await expect(switcher).toBeVisible()

    await switcher.click()
    await page.waitForURL(/\/en/)

    await expect(page.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Explore', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Publish', exact: true })).toBeVisible()
  })
})

test.describe('explore page', () => {
  test('loads /explore with item grid', async ({ page }) => {
    await page.goto('/zh-CN/explore')
    const itemCards = page.locator('a[href^="/listing/"]')
    await expect(itemCards.first()).toBeVisible()
  })

  test('filter sidebar is present (desktop viewport)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/zh-CN/explore')
    // filter card has "筛选" header — use first() because there may be other matches
    await expect(page.getByText('筛选').first()).toBeVisible()
  })

  test('shows "共 N 件商品" count', async ({ page }) => {
    await page.goto('/zh-CN/explore')
    await expect(page.getByText(/共.*件商品/)).toBeVisible()
  })
})

test.describe('listing detail page', () => {
  test('shows item title, price, and tabs', async ({ page }) => {
    await page.goto('/zh-CN/listing/item_001')
    // Item 001 is iPhone 15 Pro
    await expect(page.locator('h1')).toContainText(/iPhone/)
    // price in CNY
    await expect(page.getByText(/¥6,899/)).toBeVisible()
    // tabs
    await expect(page.getByRole('tab', { name: /商品描述/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /相关推荐/ })).toBeVisible()
  })

  test('clicking "立即购买" opens the BuyModal', async ({ page }) => {
    await page.goto('/zh-CN/listing/item_001')
    await page.getByRole('button', { name: '立即购买' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('确认购买')).toBeVisible()
  })
})

test.describe('publish page', () => {
  test('loads with form fields', async ({ page }) => {
    await page.goto('/zh-CN/publish')
    await expect(page.locator('h1')).toContainText(/发布商品/)
    // Type toggle should be present
    await expect(page.getByRole('tab', { name: /实物二手/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /数字资产/ })).toBeVisible()
  })

  test('submitting invalid form shows validation', async ({ page }) => {
    await page.goto('/zh-CN/publish')
    // Submit empty form
    await page.getByRole('button', { name: '立即发布' }).click()
    // Should show validation errors (title too short, description too short, etc.)
    await expect(page.getByText(/标题至少/)).toBeVisible()
  })
})

test.describe('me page', () => {
  test('loads with profile and orders tabs', async ({ page }) => {
    await page.goto('/zh-CN/me')
    // Profile section should be present
    await expect(page.locator('h1')).toBeVisible()
    // Order tabs
    await expect(page.getByRole('tab', { name: /我买到的/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /我卖出的/ })).toBeVisible()
  })
})

test.describe('seller page', () => {
  test('loads public seller page', async ({ page }) => {
    await page.goto('/zh-CN/seller/seller_004') // mobile_zone
    await expect(page.locator('h1')).toContainText('mobile_zone')
  })

  test('shows seller items', async ({ page }) => {
    await page.goto('/zh-CN/seller/seller_004')
    const items = page.locator('a[href^="/listing/"]')
    await expect(items.first()).toBeVisible()
  })
})

test.describe('routing', () => {
  test('default locale root shows home content', async ({ page }) => {
    // with localePrefix: 'always', every path needs locale prefix
    await page.goto('/zh-CN')
    await page.waitForLoadState('domcontentloaded')
    await expect(page).toHaveTitle(/Bazaar Web3/)
  })

  test('unknown item 404s', async ({ page }) => {
    const response = await page.goto('/zh-CN/listing/item_does_not_exist')
    // 404 page
    expect(response?.status()).toBe(404)
  })
})

test.describe('favorites — localStorage persistence', () => {
  test('toggling favorite persists across navigation', async ({ page }) => {
    await page.goto('/zh-CN/listing/item_001')

    // Click favorite button
    const favoriteButton = page.getByRole('button', { name: /收藏/ }).first()
    await favoriteButton.click()

    // Button text should change to "已收藏"
    await expect(page.getByRole('button', { name: /已收藏/ })).toBeVisible()

    // Navigate away and back
    await page.goto('/zh-CN/explore')
    await page.goto('/zh-CN/listing/item_001')

    // Should still be favorited
    await expect(page.getByRole('button', { name: /已收藏/ })).toBeVisible()
  })
})