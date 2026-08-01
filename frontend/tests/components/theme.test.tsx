import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, useTheme } from '@/components/layout/theme-provider'
import { ModeToggle } from '@/components/layout/mode-toggle'

beforeEach(() => {
  document.documentElement.classList.remove('light', 'dark')
  window.localStorage.clear()
})

function Probe() {
  const { theme, setTheme } = useTheme()
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <button onClick={() => setTheme('dark')}>set dark</button>
      <button onClick={() => setTheme('light')}>set light</button>
    </div>
  )
}

describe('ThemeProvider', () => {
  it('defaults to light theme when no preference stored', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByTestId('current-theme')).toHaveTextContent('light')
  })

  it('applies "light" class on documentElement by default', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  it('setTheme("dark") updates state, html class, and localStorage', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    await user.click(screen.getByText('set dark'))
    expect(screen.getByTestId('current-theme')).toHaveTextContent('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem('c2c:theme')).toBe('"dark"')
  })

  it('setTheme("light") updates state and html class', async () => {
    const user = userEvent.setup()
    document.documentElement.classList.add('dark')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    await user.click(screen.getByText('set light'))
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('restores theme from localStorage on mount', () => {
    window.localStorage.setItem('c2c:theme', JSON.stringify('dark'))
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByTestId('current-theme')).toHaveTextContent('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('respects system preference when no localStorage and no manual choice', () => {
    // matchMedia mock
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false
      })
    })
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByTestId('current-theme')).toHaveTextContent('dark')
  })
})

describe('useTheme', () => {
  it('throws when used outside ThemeProvider', () => {
    // Suppress console.error for this test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/must be used within ThemeProvider/)
    spy.mockRestore()
  })
})

describe('ModeToggle', () => {
  it('renders a button that toggles theme on click', async () => {
    const user = userEvent.setup()
    // ensure clean light state and reset any matchMedia mock from prior test
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add('light')
    window.localStorage.clear()
    // default matchMedia returns false (light) — overwrite any earlier mock
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
    render(
      <ThemeProvider>
        <ModeToggle />
      </ThemeProvider>
    )
    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
    await user.click(button)
    // After click, theme should change
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})