import { beforeEach, expect, test } from 'vitest'
import { useFilterStore } from '@/stores/use-filter-store'

beforeEach(() => useFilterStore.getState().reset())

test('changing a category or type removes a conflicting selection', () => {
  const filter = useFilterStore.getState()
  filter.setItemCategory('physical')
  filter.setCategory('digital_assets')
  expect(useFilterStore.getState()).toMatchObject({ category: 'digital_assets', itemCategory: undefined })

  filter.setItemCategory('physical')
  expect(useFilterStore.getState()).toMatchObject({ category: undefined, itemCategory: 'physical' })
})
