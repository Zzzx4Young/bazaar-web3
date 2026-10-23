import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { AlphaHero } from '@/components/home/alpha-hero'
import zhMessages from '@/../messages/zh-CN.json'
import enMessages from '@/../messages/en.json'
import type { Item } from '@/types'

vi.unmock('next-intl')

const item: Item = {
  id: 'featured-listing',
  sellerId: 'seller-1',
  title: 'Featured listing',
  description: '',
  category: 'physical',
  tags: [],
  price: { amount: 100, currency: 'USD' },
  media: [{ type: 'image', url: '/cover.jpg', alt: 'Featured cover' }],
  status: 'active',
  viewCount: 0,
  favoriteCount: 0,
  createdAt: '',
  updatedAt: ''
}

function renderHero(locale: 'zh-CN' | 'en', illustrativeImage: boolean | null | undefined) {
  const listing = { ...item, illustrativeImage } as Item
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'zh-CN' ? zhMessages : enMessages}>
      <AlphaHero item={listing} />
    </NextIntlClientProvider>
  )
  return within(screen.getByRole('link', { name: /Featured listing/ }))
}

describe('AlphaHero illustrative image disclosure', () => {
  it.each([
    ['zh-CN', '示意图'],
    ['en', 'Illustration']
  ] as const)('shows the disclosure in %s for an illustrative cover', (locale, label) => {
    const imageLink = renderHero(locale, true)
    expect(imageLink.getByText(label)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: `Featured listing · ${label}` })).toBeInTheDocument()
    expect(imageLink.getByRole('img', { name: 'Featured cover' })).toBeInTheDocument()
  })

  it.each([false, undefined, null])('does not show a disclosure when the flag is %s', (flag) => {
    const imageLink = renderHero('zh-CN', flag)
    expect(imageLink.queryByText('示意图')).not.toBeInTheDocument()
  })
})
