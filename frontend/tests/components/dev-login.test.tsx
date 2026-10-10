import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TopNav } from '@/components/layout/top-nav'
import LoginPage from '@/app/[locale]/login/page'
import { useAuthStore } from '@/stores/use-auth-store'

vi.mock('@/components/layout/mode-toggle', () => ({ ModeToggle: () => null }))
vi.mock('@/components/layout/favorites-link', () => ({ FavoritesLink: () => null }))
vi.mock('@/components/layout/brand-logo', () => ({ BrandLogo: () => null }))

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('NEXT_PUBLIC_DEV_LOGIN_NAME', 'local-buyer@test.com')
  vi.stubEnv('NEXT_PUBLIC_DEV_LOGIN_PASSWORD', 'local-test-password')
  useAuthStore.setState({ status: 'anonymous', view: null, error: null })
})

afterEach(() => vi.unstubAllEnvs())

describe('development login autofill', () => {
  it('fills both fields when opening the header login dialog', () => {
    render(<TopNav />)
    fireEvent.click(screen.getByRole('button', { name: 'login' }))
    expect(screen.getByLabelText('loginName')).toHaveValue('local-buyer@test.com')
    expect(screen.getByLabelText('password')).toHaveValue('local-test-password')
  })

  it('fills the dedicated login page', () => {
    render(<LoginPage />)
    expect(screen.getByLabelText('loginName')).toHaveValue('local-buyer@test.com')
    expect(screen.getByLabelText('password')).toHaveValue('local-test-password')
  })

  it('keeps the login fields blank outside development', () => {
    vi.stubEnv('NODE_ENV', 'production')
    render(<LoginPage />)
    expect(screen.getByLabelText('loginName')).toHaveValue('')
    expect(screen.getByLabelText('password')).toHaveValue('')
  })
})
