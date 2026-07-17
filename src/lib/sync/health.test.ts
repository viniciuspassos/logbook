import { isBackendReachable } from './health.ts'

function installFetch(): jest.MockedFunction<typeof fetch> {
  const mock = jest.fn() as jest.MockedFunction<typeof fetch>
  globalThis.fetch = mock
  return mock
}

afterEach(() => {
  delete (globalThis as { fetch?: typeof fetch }).fetch
})

describe('isBackendReachable', () => {
  it('is false when fetch is unavailable', async () => {
    expect(await isBackendReachable()).toBe(false)
  })

  it('is true when /health responds ok', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue({ ok: true } as Response)
    expect(await isBackendReachable()).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ credentials: 'include' }))
  })

  it('is false when /health responds with a non-ok status', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue({ ok: false } as Response)
    expect(await isBackendReachable()).toBe(false)
  })

  it('is false when fetch throws (offline)', async () => {
    const fetchMock = installFetch()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await isBackendReachable()).toBe(false)
  })
})
