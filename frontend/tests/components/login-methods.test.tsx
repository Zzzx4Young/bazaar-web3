import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import LoginPage from '@/app/[locale]/login/page'
import { TopNav } from '@/components/layout/top-nav'
import { useAuthStore } from '@/stores/use-auth-store'
import zhMessages from '@/../messages/zh-CN.json'
import enMessages from '@/../messages/en.json'

vi.mock('@/components/layout/mode-toggle', () => ({ ModeToggle: () => null }))
vi.mock('@/components/layout/favorites-link', () => ({ FavoritesLink: () => null }))
vi.mock('@/components/layout/brand-logo', () => ({ BrandLogo: () => null }))

beforeEach(() => {
  useAuthStore.setState({ status: 'anonymous', view: null, error: null })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, headers: new Headers(),
    json: async () => ({ password: true, google: true, emailCode: true })
  }))
})

it('switches the login page between password and Gmail code forms', async () => {
  render(<LoginPage />)
  expect(screen.getByLabelText('loginName')).toBeVisible()
  expect(screen.getByLabelText('password')).toBeVisible()
  expect(screen.queryByLabelText('emailAddress')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'passwordLogin' })).toHaveAttribute('aria-pressed', 'true')
  expect(await screen.findByRole('button', { name: 'googleSignIn' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'emailCodeLogin' }))
  expect(screen.getByRole('button', { name: 'emailCodeLogin' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByLabelText('password')).not.toBeInTheDocument()
  expect(await screen.findByLabelText('emailAddress')).toBeVisible()
  expect(screen.getByRole('button', { name: 'googleSignIn' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'passwordLogin' }))
  expect(screen.getByLabelText('password')).toBeVisible()
  expect(screen.queryByLabelText('emailAddress')).not.toBeInTheDocument()
})

it('switches the header login dialog between password and Gmail code forms', async () => {
  render(<TopNav />)
  fireEvent.click(screen.getByRole('button', { name: 'login' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByLabelText('loginName')).toBeVisible()
  expect(within(dialog).getByLabelText('password')).toBeVisible()
  expect(within(dialog).queryByLabelText('emailAddress')).not.toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'passwordLogin' }))
    .toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(within(dialog).getByRole('button', { name: 'emailCodeLogin' }))
  expect(within(dialog).queryByLabelText('password')).not.toBeInTheDocument()
  expect(await within(dialog).findByLabelText('emailAddress')).toBeVisible()
  expect(within(dialog).getByRole('button', { name: 'googleSignIn' })).toBeVisible()
})

it('returns to password login when the header dialog is opened again', async () => {
  render(<TopNav />)
  fireEvent.click(screen.getByRole('button', { name: 'login' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'emailCodeLogin' }))
  expect(await within(screen.getByRole('dialog')).findByLabelText('emailAddress')).toBeVisible()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
  fireEvent.click(screen.getByRole('button', { name: 'login' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByLabelText('password')).toBeVisible()
  expect(within(dialog).queryByLabelText('emailAddress')).not.toBeInTheDocument()
})

it('translates both login method choices', () => {
  expect(zhMessages.nav.passwordLogin).toBe('密码登录')
  expect(zhMessages.nav.emailCodeLogin).toBe('邮箱验证码登录')
  expect(enMessages.nav.passwordLogin).toBe('Password sign-in')
  expect(enMessages.nav.emailCodeLogin).toBe('Email code sign-in')
})
