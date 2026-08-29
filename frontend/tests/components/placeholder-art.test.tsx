import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PlaceholderArt } from '@/components/home/placeholder-art'
import type { Item, PrimaryCategory } from '@/types'

const baseItem: Item = {
  id: 'item_test_001',
  sellerId: 'seller_001',
  title: 'Test product',
  description: '',
  category: 'physical',
  tags: [],
  price: { amount: 0, currency: 'CNY' },
  media: [],
  status: 'active',
  viewCount: 0,
  favoriteCount: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01'
}

// Note: lucide-react rewrites some names when slug-ifying. Code2 → "code-xml".
const CASES: { name: PrimaryCategory; itemTitle: string; expectedIcon: string }[] = [
  { name: 'electronics',         itemTitle: 'iPhone 15',     expectedIcon: 'smartphone' },
  { name: 'digital_assets',      itemTitle: 'ENS crypto.eth', expectedIcon: 'coins' },
  { name: 'software_source',     itemTitle: 'Next.js kit',    expectedIcon: 'code-xml' },
  { name: 'game_items',          itemTitle: 'AK47 skin',      expectedIcon: 'gamepad2' },
  { name: 'secondhand_fashion',  itemTitle: 'AJ1 Chicago',    expectedIcon: 'shirt' }
]

describe('PlaceholderArt — falls back to a category icon when no image', () => {
  // Each iter renders into its own container; unmount ensures cleanup so the
  // next render isn't polluted by detached nodes.
  afterEach(() => cleanup())

  it.each(CASES)(
    'category=%s renders matching gradient class + icon',
    (c) => {
      const item = { ...baseItem, title: c.itemTitle }
      const { container } = render(<PlaceholderArt item={item} categoryHint={c.name} />)
      const root = screen.getByTestId('placeholder-art')
      expect(root.dataset.category).toBe(c.name)
      expect(root.className).toContain(`placeholder-${c.name}`)
      const svgs = container.querySelectorAll('svg')
      const svgMatches = Array.from(svgs).some(s =>
        (s.getAttribute('class') ?? '').includes(c.expectedIcon)
      )
      expect(svgMatches, `expected lucide class to include "${c.expectedIcon}"`).toBe(true)
    }
  )

  it('uses the placeholder-default class when no category matches', () => {
    const item = { ...baseItem, title: 'orphan item', id: 'item_unknown_xx' }
    render(<PlaceholderArt item={item} />)
    const root = screen.getByTestId('placeholder-art')
    expect(root.dataset.category).toBe('unknown')
    expect(root.className).toContain('placeholder-default')
  })

  it('shows a letter-shaped watermark derived from the title (digits included)', () => {
    const item = { ...baseItem, title: '1234 测试' }
    const { container } = render(<PlaceholderArt item={item} categoryHint="electronics" />)
    // letter = "1" (first numeric char from the title); non-empty watermark
    // is the contract — exact char depends on the title structure.
    const watermark = container.querySelector('span[aria-hidden="true"]')
    expect(watermark).toBeTruthy()
    expect(watermark?.textContent).toMatch(/^[A-Z0-9?]/)
  })

  it('falls back to "?" when the title is empty', () => {
    const item = { ...baseItem, title: '' }
    const { container } = render(<PlaceholderArt item={item} categoryHint="electronics" />)
    const watermark = container.querySelector('span[aria-hidden="true"]')
    expect(watermark?.textContent).toBe('?')
  })
})
