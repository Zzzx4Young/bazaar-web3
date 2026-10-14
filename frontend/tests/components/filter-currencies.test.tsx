import { afterEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { FilterSidebar } from '@/components/explore/filter-sidebar'
import type { FilterState } from '@/types'

afterEach(() => vi.unstubAllGlobals())

it('shows a selected currency supplied by the backend catalog', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { code: 'CNY', scale: 2 },
            { code: 'BRL', scale: 2 }
          ]),
          { status: 200 }
        )
    )
  )
  const filter: FilterState = { sortBy: 'newest', page: 1, pageSize: 10, currency: 'BRL' }
  render(
    <FilterSidebar
      categories={[]}
      filter={filter}
      onKeyword={() => {}}
      onCategory={() => {}}
      onItemCategory={() => {}}
      onCurrency={() => {}}
      onReset={() => {}}
    />
  )
  await waitFor(() => expect(screen.getAllByRole('combobox')[2]).toHaveTextContent('BRL'))
})
