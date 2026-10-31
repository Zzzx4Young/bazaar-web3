import '@testing-library/jest-dom/vitest'

// Mock next/image to render plain <img> in tests (jsdom can't process Next's Image optimizer)
vi.mock('next/image', () => ({
  default: ({ src, alt, onError }: { src: string; alt: string; onError?: React.ReactEventHandler<HTMLImageElement> }) => {
    // eslint-disable-next-line @next/next/no-img-element
    const React = require('react')
    return React.createElement('img', { src, alt, onError })
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

// Keep existing key-only mocks, but exercise the newly localized account and record UI with real copy.
const localizedNamespaces = new Set([
  'mePage', 'myOrders', 'myListings', 'profileHeader', 'createListing',
  'notificationsPage', 'favoritesPage', 'routeState', 'recordPagination'
])
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, string | number>) => {
    if (!localizedNamespaces.has(namespace)) return key
    const messages = require('../messages/zh-CN.json') as Record<string, Record<string, string>>
    const message = messages[namespace]?.[key] ?? key
    return message.replace(/\{(\w+)\}/g, (_match, name: string) => String(values?.[name] ?? ''))
  },
  useLocale: vi.fn(() => 'zh-CN')
}))

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => {
    const React = require('react')
    return React.createElement('a', { href, ...props }, children)
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/'
}))
