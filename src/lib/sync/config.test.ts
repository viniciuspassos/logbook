import { getApiBaseUrl } from './config.ts'

afterEach(() => {
  delete window.__LOGBOOK_API_BASE_URL__
})

describe('getApiBaseUrl', () => {
  it('defaults to same-origin /api when no override is set', () => {
    expect(getApiBaseUrl()).toBe('/api')
  })

  it('returns the window override when set', () => {
    window.__LOGBOOK_API_BASE_URL__ = 'https://api.example.com'
    expect(getApiBaseUrl()).toBe('https://api.example.com')
  })

  it('ignores a blank override and falls back to the default', () => {
    window.__LOGBOOK_API_BASE_URL__ = '   '
    expect(getApiBaseUrl()).toBe('/api')
  })
})
