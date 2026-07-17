import { readCookie, readCsrfToken } from './csrf.ts'

afterEach(() => {
  // jsdom has no `document.cookie` clear helper; expire everything we set.
  for (const part of document.cookie.split(';')) {
    const key = part.split('=')[0]?.trim()
    if (key) document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`
  }
})

describe('readCookie', () => {
  it('returns null when the cookie is absent', () => {
    expect(readCookie('missing')).toBeNull()
  })

  it('reads a single cookie', () => {
    document.cookie = 'foo=bar'
    expect(readCookie('foo')).toBe('bar')
  })

  it('reads one cookie among several', () => {
    document.cookie = 'a=1'
    document.cookie = 'b=2'
    document.cookie = 'c=3'
    expect(readCookie('b')).toBe('2')
  })

  it('URL-decodes the value', () => {
    document.cookie = `enc=${encodeURIComponent('a b/c')}`
    expect(readCookie('enc')).toBe('a b/c')
  })
})

describe('readCsrfToken', () => {
  it('returns null before login', () => {
    expect(readCsrfToken()).toBeNull()
  })

  it('reads the logbook_csrf cookie', () => {
    document.cookie = 'logbook_csrf=tok123'
    expect(readCsrfToken()).toBe('tok123')
  })
})
