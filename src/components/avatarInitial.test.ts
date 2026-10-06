import { avatarInitial } from './avatarInitial.ts'

describe('avatarInitial', () => {
  it.each([
    [{ id: 1, email: 'ada@example.com', name: 'ada lovelace', picture: null }, 'A'],
    [{ id: 1, email: 'grace@example.com', name: null, picture: null }, 'G'],
    [{ id: 1, email: 'x@example.com', name: '   ', picture: null }, 'X'],
    [{ id: 1, email: 'x@example.com', name: '\u{1F9D7} Climber', picture: null }, '\u{1F9D7}'],
    [{ id: 1, email: 'x@example.com', name: '\u{10437}rw', picture: null }, '\u{1040F}'],
  ])('%j -> %s', (profile, expected) => {
    expect(avatarInitial(profile)).toBe(expected)
  })
})
