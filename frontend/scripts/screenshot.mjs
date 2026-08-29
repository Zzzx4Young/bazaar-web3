#!/usr/bin/env node
/**
 * Capture README screenshots of the running app.
 *
 *   cd frontend
 *   npm run dev &       # in another shell, or rely on auto-port below
 *   npm run screenshot
 *
 * Output: docs/screenshots/*.png  (relative to repo root)
 *
 * Notes:
 *   - Reuses the dev server on port 3737 if already running.
 *   - Falls back to starting one itself (this is what CI would do).
 *   - Not wired into `test:e2e`; this is a manual artifact, not a test.
 */

import { chromium, devices } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import path from 'node:path'
import process from 'node:process'

const PORT = 3737
const BASE = `http://localhost:${PORT}`
const OUT_DIR = path.resolve(process.cwd(), '../docs/screenshots')

const SHOTS = [
  { name: 'home-desktop.png',     url: '/zh-CN',             viewport: { width: 1280, height: 800 } },
  { name: 'listing-desktop.png',  url: '/zh-CN/listing/item_001', viewport: { width: 1280, height: 800 } },
  { name: 'explore-desktop.png',  url: '/zh-CN/explore',     viewport: { width: 1280, height: 800 } },
  { name: 'favorites-desktop.png',url: '/zh-CN/favorites',   viewport: { width: 1280, height: 800 } },
  { name: 'home-mobile.png',      url: '/zh-CN',             viewport: { width: 390, height: 844 } },
]

async function pingOk() {
  try {
    const r = await fetch(`${BASE}/zh-CN`)
    return r.ok
  } catch { return false }
}

async function waitForServer(deadlineMs) {
  while (Date.now() < deadlineMs) {
    if (await pingOk()) return true
    await wait(500)
  }
  return false
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  let devChild
  if (await pingOk()) {
    console.log(`Server already up on :${PORT}`)
  } else {
    console.log(`Server not up on :${PORT} — starting dev server...`)
    devChild = spawn('npm', ['run', 'dev', '--', '--port', String(PORT)], {
      stdio: 'inherit',
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
    })
    const up = await waitForServer(Date.now() + 60_000)
    if (!up) {
      devChild.kill()
      console.error('Dev server never came up')
      process.exit(1)
    }
    await wait(1500)
  }

  const browser = await chromium.launch()
  try {
    async function shoot(shot) {
      const ctx = await browser.newContext({
        viewport: shot.viewport,
        locale: 'zh-CN',
        deviceScaleFactor: 2
      })
      const page = await ctx.newPage()
      const fullUrl = BASE + shot.url
      console.log(`→ ${shot.name}  ${fullUrl}  (${shot.viewport.width}x${shot.viewport.height})`)
      await page.goto(fullUrl, { waitUntil: 'load', timeout: 45_000 })
      await page.waitForLoadState('domcontentloaded')
      try {
        await page.waitForSelector('main, h1, h2, [data-ready]', { timeout: 5_000 })
      } catch { /* empty state — still snap */ }
      await wait(1500)
      const file = path.join(OUT_DIR, shot.name)
      await page.screenshot({ path: file, fullPage: false })
      await ctx.close()
    }
    for (const shot of SHOTS) {
      await shoot(shot)
    }
  } finally {
    await browser.close()
    if (devChild) devChild.kill()
  }

  console.log(`\nWrote ${SHOTS.length} screenshots to ${path.relative(process.cwd(), OUT_DIR) || OUT_DIR}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
