import { getGoogleClientId } from './config.ts'

afterEach(() => {
  delete window.__LOGBOOK_GOOGLE_CLIENT_ID__
})

describe('getGoogleClientId', () => {
  it('is null when no client ID is configured', () => {
    expect(getGoogleClientId()).toBeNull()
  })

  it('returns the trimmed window global when set', () => {
    window.__LOGBOOK_GOOGLE_CLIENT_ID__ = '  abc.apps.googleusercontent.com '
    expect(getGoogleClientId()).toBe('abc.apps.googleusercontent.com')
  })

  it('treats a blank value as unset', () => {
    window.__LOGBOOK_GOOGLE_CLIENT_ID__ = '   '
    expect(getGoogleClientId()).toBeNull()
  })
})
