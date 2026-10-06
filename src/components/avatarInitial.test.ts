import { avatarInitial } from './avatarInitial.ts'

describe('avatarInitial', () => {
  it.each([
    [{ id: 1, email: 'ada@example.com', name: 'ada lovelace', picture: null }, 'A'],
    [{ id: 1, email: 'grace@example.com', name: null, picture: null }, 'G'],
    [{ id: 1, email: 'x@example.com', name: '   ', picture: null }, 'X'],
  ])('%j -> %s', (profile, expected) => {
    expect(avatarInitial(profile)).toBe(expected)
  })
})
