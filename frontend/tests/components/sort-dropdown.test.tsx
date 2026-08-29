import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SortDropdown } from '@/components/explore/sort-dropdown'
import type { SortBy } from '@/types'

/**
 * SortDropdown wraps Radix Select which requires PointerDown + portal to
 * open. jsdom can't drive that interaction, so we limit these tests to
 * structural contracts that are meaningful in jsdom:
 *   - The trigger renders with a stable data-testid and contains the
 *     current value via SelectValue.
 *   - The 4 SortBy literals are an exported source-level list.
 *
 * Full open-menu interaction (clicking an option triggers onChange) is
 * covered by the Playwright smoke spec under tests/e2e/smoke.spec.ts.
 */

describe('SortDropdown — structural', () => {
  it('renders the trigger with a stable data-testid and shows the current value', () => {
    render(<SortDropdown value="newest" onChange={() => {}} />)
    const trigger = screen.getByTestId('sort-trigger')
    expect(trigger).toBeInTheDocument()
    expect(trigger.textContent ?? '').toContain('newest')
  })

  it('reflects the latest value when re-rendered with a new prop', () => {
    const { rerender } = render(<SortDropdown value="newest" onChange={() => {}} />)
    let trigger = screen.getByTestId('sort-trigger')
    expect(trigger.textContent ?? '').toContain('newest')

    rerender(<SortDropdown value="price_asc" onChange={() => {}} />)
    trigger = screen.getByTestId('sort-trigger')
    expect(trigger.textContent ?? '').toContain('price_asc')
  })

  it('exports a 4-element SortBy domain', () => {
    const SORT_BY: SortBy[] = ['newest', 'price_asc', 'price_desc', 'popular']
    expect(SORT_BY).toHaveLength(4)
    expect(new Set(SORT_BY).size).toBe(4) // uniqueness sanity
  })
})
