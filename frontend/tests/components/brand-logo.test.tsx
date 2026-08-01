import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrandLogo } from '@/components/layout/brand-logo'
import { ThemeProvider } from '@/components/layout/theme-provider'

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  )
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key
}))

beforeEach(() => {
  document.documentElement.classList.remove('light', 'dark')
  window.localStorage.clear()
  // Reset matchMedia to a deterministic default so we test only what we
  // control (the theme state in the provider).
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    })
  })
})

describe('BrandLogo', () => {
  it('renders the brand text', () => {
    render(
      <ThemeProvider>
        <BrandLogo />
      </ThemeProvider>
    )
    expect(screen.getByText('Bazaar Web3')).toBeInTheDocument()
  })

  it('links to the home page', () => {
    render(
      <ThemeProvider>
        <BrandLogo />
      </ThemeProvider>
    )
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/')
  })

  it('exposes a non-empty className', () => {
    render(
      <ThemeProvider>
        <BrandLogo />
      </ThemeProvider>
    )
    const link = screen.getByRole('link')
    expect(link.className).toBeTruthy()
    expect(link.className.length).toBeGreaterThan(0)
  })
})