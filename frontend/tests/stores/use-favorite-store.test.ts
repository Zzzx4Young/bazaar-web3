import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useFavoriteStore } from '@/stores/use-favorite-store'

beforeEach(() => {
  window.localStorage.clear()
})

describe('useFavoriteStore — initial state', () => {
  it('starts with empty favorites', () => {
    const { result } = renderHook(() => useFavoriteStore())
    expect(result.current.favorites).toEqual([])
  })

  it('isFavorite returns false for unknown item', () => {
    const { result } = renderHook(() => useFavoriteStore())
    expect(result.current.isFavorite('item_001')).toBe(false)
  })
})

describe('useFavoriteStore — toggle', () => {
  it('adds an item to favorites when toggled on', () => {
    const { result } = renderHook(() => useFavoriteStore())
    act(() => result.current.toggle('item_001'))
    expect(result.current.favorites).toContain('item_001')
    expect(result.current.isFavorite('item_001')).toBe(true)
  })

  it('removes an item from favorites when toggled off', () => {
    const { result } = renderHook(() => useFavoriteStore())
    act(() => result.current.toggle('item_001'))
    expect(result.current.isFavorite('item_001')).toBe(true)

    act(() => result.current.toggle('item_001'))
    expect(result.current.isFavorite('item_001')).toBe(false)
    expect(result.current.favorites).not.toContain('item_001')
  })

  it('preserves other items when toggling', () => {
    const { result } = renderHook(() => useFavoriteStore())
    act(() => result.current.toggle('item_001'))
    act(() => result.current.toggle('item_002'))
    expect(result.current.favorites).toEqual(['item_001', 'item_002'])

    act(() => result.current.toggle('item_001'))
    expect(result.current.favorites).toEqual(['item_002'])
  })

  it('does not duplicate when toggled twice without off', () => {
    const { result } = renderHook(() => useFavoriteStore())
    act(() => result.current.toggle('item_001'))
    // toggle('item_001') again would un-favorite, then re-favorite
    act(() => result.current.toggle('item_001'))
    act(() => result.current.toggle('item_001'))
    expect(result.current.favorites.filter((id: string) => id === 'item_001')).toHaveLength(1)
  })
})

describe('useFavoriteStore — localStorage persistence', () => {
  // P1-B: this store is implemented as React useState + useLocalStorage
  // (not a true Zustand singleton). Each mount() = independent React state.
  // What IS shared across components is the localStorage key
  // 'c2c:user:favorites'. This suite covers the persistence contract.

  it('writes the latest favorites to localStorage on toggle', () => {
    const { result } = renderHook(() => useFavoriteStore())
    act(() => result.current.toggle('item_persist_1'))
    act(() => result.current.toggle('item_persist_2'))
    const raw = window.localStorage.getItem('c2c:user:favorites')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed).toEqual(['item_persist_1', 'item_persist_2'])
  })

  it('rehydrates favorites from localStorage on mount', () => {
    // Pre-seed before the hook mounts.
    window.localStorage.setItem(
      'c2c:user:favorites',
      JSON.stringify(['item_seeded_a', 'item_seeded_b'])
    )
    const { result } = renderHook(() => useFavoriteStore())
    expect(result.current.favorites).toEqual(['item_seeded_a', 'item_seeded_b'])
    expect(result.current.isFavorite('item_seeded_a')).toBe(true)
    expect(result.current.isFavorite('item_seeded_b')).toBe(true)
    expect(result.current.isFavorite('item_never_seeded')).toBe(false)
  })

  it('survives a remount by re-reading from localStorage', () => {
    const first = renderHook(() => useFavoriteStore())
    act(() => first.result.current.toggle('item_rehydrate'))
    first.unmount()

    const second = renderHook(() => useFavoriteStore())
    expect(second.result.current.favorites).toContain('item_rehydrate')
    expect(second.result.current.isFavorite('item_rehydrate')).toBe(true)
  })

  it('toggles are reflected in the same component immediately', () => {
    // Single instance: this guards against a regression where toggle no
    // longer wrote back to the favorites array on the same render.
    const { result } = renderHook(() => useFavoriteStore())
    const initial = result.current.favorites.length
    act(() => result.current.toggle('item_same_component'))
    expect(result.current.favorites).toHaveLength(initial + 1)
    expect(result.current.isFavorite('item_same_component')).toBe(true)
  })
})
it('synchronizes mounted consumers and preserves rapid updates', () => {
  const first = renderHook(() => useFavoriteStore())
  const second = renderHook(() => useFavoriteStore())
  act(() => {
    first.result.current.toggle('item_a')
    second.result.current.toggle('item_b')
  })
  expect(first.result.current.favorites).toEqual(['item_a', 'item_b'])
  expect(second.result.current.favorites).toEqual(['item_a', 'item_b'])
})

it('reacts to changes and clearing from another tab', () => {
  const { result } = renderHook(() => useFavoriteStore())
  act(() => {
    localStorage.setItem('c2c:user:favorites', JSON.stringify(['other_tab']))
    window.dispatchEvent(new StorageEvent('storage', { key: 'c2c:user:favorites' }))
  })
  expect(result.current.favorites).toEqual(['other_tab'])
  act(() => {
    localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
  })
  expect(result.current.favorites).toEqual([])
})
