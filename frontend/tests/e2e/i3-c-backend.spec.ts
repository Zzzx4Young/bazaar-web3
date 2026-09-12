import { test, expect, type Page } from '@playwright/test'

const login = async (page: Page, name: string) => {
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill(process.env.I3_PASSWORD ?? '')
  await page.getByRole('button', { name: '登录', exact: true }).last().click()
  await expect(page.getByRole('button', { name: name === process.env.I3_ALICE ? 'Alice' : 'Bob' })).toBeVisible()
}

test('I3-C independent sessions publish and observe a backend listing', async ({ browser, baseURL }) => {
  const alice = process.env.I3_ALICE
  const bob = process.env.I3_BOB
  if (!alice || !bob || !process.env.I3_PASSWORD) test.skip()

  const aliceContext = await browser.newContext({ baseURL })
  const bobContext = await browser.newContext({ baseURL })
  const alicePage = await aliceContext.newPage()
  const bobPage = await bobContext.newPage()
  try {
    await alicePage.goto('/zh-CN')
    await login(alicePage, alice!)
    await alicePage.goto('/zh-CN/publish')
    await alicePage.getByLabel('标题').fill('I3-C backend listing')
    await alicePage.getByLabel('详细描述').fill('A listing created by the backend integration check.')
    await alicePage.locator('input[name="priceAmount"]').fill('12.50')
    await alicePage.getByText('选择成色').click()
    await alicePage.getByRole('option', { name: '全新' }).click()
    await alicePage.getByRole('button', { name: '立即发布' }).click()
    await expect(alicePage).toHaveURL(/\/listing\//)

    await bobPage.goto('/zh-CN/explore')
    await login(bobPage, bob!)
    await bobPage.goto('/zh-CN/explore')
    await expect(bobPage.getByText('I3-C backend listing')).toBeVisible()
    await bobPage.reload()
    await expect(bobPage.getByText('I3-C backend listing')).toBeVisible()
  } finally {
    await aliceContext.close()
    await bobContext.close()
  }
})
