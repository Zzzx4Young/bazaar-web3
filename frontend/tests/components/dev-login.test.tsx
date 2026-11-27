import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TopNav } from '@/components/layout/top-nav'
import LoginPage from '@/app/[locale]/login/page'
import { useAuthStore } from '@/stores/use-auth-store'

vi.mock('@/components/layout/mode-toggle', () => ({ ModeToggle: () => null }))
vi.mock('@/components/layout/favorites-link', () => ({ FavoritesLink: () => null }))
vi.mock('@/components/layout/brand-logo', () => ({ BrandLogo: () => null }))

beforeEach(() => {
  // IdentityOptions fetches /auth/methods for each mounted login surface.
  // These field-only tests must not contact whichever local API happens to be running.
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            password: true,
            google: true,
            emailCode: true
          }),
          { status: 200 }
        )
    )
  )
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('NEXT_PUBLIC_DEV_LOGIN_NAME', 'local-buyer@test.com')
  vi.stubEnv('NEXT_PUBLIC_DEV_LOGIN_PASSWORD', 'local-test-password')
  useAuthStore.setState({ status: 'anonymous', view: null, error: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

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

it('loads login methods from an explicit test fixture without requiring a local API', async () => {
  render(<LoginPage />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'googleSignIn' })).toBeEnabled())
})
