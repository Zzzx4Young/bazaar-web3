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
    expect(result.current.favorites.filter(id => id === 'item_001')).toHaveLength(1)
  })
})