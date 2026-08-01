import '@testing-library/jest-dom/vitest'

// Mock next/image to render plain <img> in tests (jsdom can't process Next's Image optimizer)
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => {
    // eslint-disable-next-line @next/next/no-img-element
    const React = require('react')
    return React.createElement('img', { src, alt })
  }
}))

// Mock next/link to render plain <a> in tests
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => {
    const React = require('react')
    return React.createElement('a', { href, ...props }, children)
  }
}))

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn()
}))

// next-intl mocks (toLocale)
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'zh-CN'
}))