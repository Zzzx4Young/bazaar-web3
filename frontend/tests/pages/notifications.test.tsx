import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Module-level mocks BEFORE importing the component
const { mockNotifications, mockMarkAllRead, mockMarkRead } = vi.hoisted(() => {
  return {
    mockNotifications: { current: [] as Array<{ id: string; kind: string; title: string; body: string; href?: string; read: boolean; createdAt: string }> },
    mockMarkAllRead: vi.fn(),
    mockMarkRead: vi.fn()
  }
})

vi.mock('@/mock/notifications', () => ({
  // Return a getter so the consumer always reads the current value of the
  // hoisted mutable ref, not the snapshot taken at module load.
  get mockNotifications() {
    return mockNotifications.current
  }
}))

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  )
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key
}))

import NotificationsPage from '@/app/[locale]/notifications/page'

describe('NotificationsPage — empty state', () => {
  beforeEach(() => {
    mockNotifications.current = []
    mockMarkAllRead.mockClear()
    mockMarkRead.mockClear()
  })

  it('shows empty state when no notifications', () => {
    render(<NotificationsPage />)
    expect(screen.getByText(/没有新通知/)).toBeInTheDocument()
  })
})

describe('NotificationsPage — with notifications', () => {
  beforeEach(() => {
    mockNotifications.current = [
      {
        id: 'n_001',
        kind: 'order',
        title: '订单已确认',
        body: '你购买的 iPhone 已发货',
        href: '/me',
        read: false,
        createdAt: '2026-08-01T08:30:00Z'
      },
      {
        id: 'n_002',
        kind: 'system',
        title: '系统通知',
        body: '平台已上线',
        read: true,
        createdAt: '2026-07-30T10:00:00Z'
      }
    ]
  })

  it('renders notification titles', () => {
    render(<NotificationsPage />)
    expect(screen.getByText('订单已确认')).toBeInTheDocument()
    expect(screen.getByText('系统通知')).toBeInTheDocument()
  })

  it('renders notification bodies', () => {
    render(<NotificationsPage />)
    expect(screen.getByText(/iPhone 已发货/)).toBeInTheDocument()
  })

  it('shows unread badge count for unread notifications', () => {
    render(<NotificationsPage />)
    // 1 unread out of 2 total — the badge '1' lives inside the heading.
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toContain('1')
  })

  it('marks unread notifications with bold title', () => {
    render(<NotificationsPage />)
    // The unread item's title should have a visual indicator (data-unread attr).
    const unread = screen.getByText('订单已确认').closest('[data-unread]')
    expect(unread).not.toBeNull()
  })

  it('links notifications with href to that target', () => {
    render(<NotificationsPage />)
    const link = screen.getByRole('link', { name: /订单已确认/ })
    expect(link.getAttribute('href')).toBe('/me')
  })
})