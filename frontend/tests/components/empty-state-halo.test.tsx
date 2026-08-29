import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '@/components/ui/empty-state'

describe('EmptyState — halo styling', () => {
  it('renders a halo wrapper for the icon', () => {
    const { container } = render(<EmptyState title="Empty" />)
    const halo = container.querySelector('.empty-halo')
    expect(halo).toBeTruthy()
  })

  it('uses a larger icon (h-9 w-9) than the original h-7 w-7', () => {
    const { container } = render(<EmptyState title="Empty" />)
    const icon = container.querySelector('svg')
    expect(icon?.className).toMatch(/h-9\b/)
    expect(icon?.className).toMatch(/w-9\b/)
  })
})
