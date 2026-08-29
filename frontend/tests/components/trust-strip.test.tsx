import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrustStrip } from '@/components/home/trust-strip'

describe('TrustStrip', () => {
  it('renders 4 trust entries with icons', () => {
    render(<TrustStrip />)
    expect(screen.getByTestId('trust-strip')).toBeInTheDocument()
    // 4 cards = 4 lucide SVGs from the icon set
    const icons = document.querySelectorAll('[data-testid="trust-strip"] svg')
    expect(icons.length).toBe(4)
  })

  it('renders the section with an aria-label', () => {
    render(<TrustStrip />)
    expect(screen.getByRole('region')).toHaveAttribute('aria-label')
  })
})
