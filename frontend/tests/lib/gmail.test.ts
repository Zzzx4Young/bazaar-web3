import { describe, expect, it } from 'vitest'
import { normalizeGmailInput } from '@/lib/gmail'

describe('normalizeGmailInput', () => {
  it('keeps the full recipient address while normalizing case and spaces', () => {
    expect(normalizeGmailInput('  User.Name+Tag.More@GMAIL.COM  '))
      .toBe('user.name+tag.more@gmail.com')
  })

  it('rejects malformed and non-Gmail addresses before a request', () => {
    for (const input of ['user@yahoo.com', 'user+@gmail.com',
      'user..name@gmail.com', 'user.+tag@gmail.com', 'user+one+two@gmail.com'])
      expect(normalizeGmailInput(input)).toBeNull()
  })
})
