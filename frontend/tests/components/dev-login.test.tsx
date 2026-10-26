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

describe('login fields', () => {
  it('opens the header login dialog with blank fields in development', () => {
    render(<TopNav />)
    fireEvent.click(screen.getByRole('button', { name: 'login' }))
    fireEvent.click(screen.getByRole('button', { name: 'passwordLogin' }))
    expect(screen.getByLabelText('loginName')).toHaveValue('')
    expect(screen.getByLabelText('password')).toHaveValue('')
  })

  it('opens the dedicated login page with blank fields in development', () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: 'passwordLogin' }))
    expect(screen.getByLabelText('loginName')).toHaveValue('')
    expect(screen.getByLabelText('password')).toHaveValue('')
  })

  it('keeps the login fields blank outside development', () => {
    vi.stubEnv('NODE_ENV', 'production')
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: 'passwordLogin' }))
    expect(screen.getByLabelText('loginName')).toHaveValue('')
    expect(screen.getByLabelText('password')).toHaveValue('')
  })
})
