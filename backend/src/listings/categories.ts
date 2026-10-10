import { DomainError } from '../common/domain-error.js'
import { textInput } from '../common/input.js'

export const categoryTypes = {
  electronics: 'physical',
  secondhand_fashion: 'physical',
  digital_assets: 'digital',
  software_source: 'digital',
  game_items: 'digital'
} as const

export function categoryInput(value: unknown, type: 'physical' | 'digital') {
  const category = textInput(value, 50)
  if (!(category in categoryTypes) || categoryTypes[category as keyof typeof categoryTypes] !== type)
    throw new DomainError('INVALID_INPUT')
  return category
}
