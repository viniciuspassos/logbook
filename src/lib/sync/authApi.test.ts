import { login, logout } from './authApi.ts'

function installFetch(): jest.MockedFunction<typeof fetch> {
  const mock = jest.fn() as jest.MockedFunction<typeof fetch>
  globalThis.fetch = mock
  return mock
}

function jsonResponse(status: number, json: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(JSON.stringify(json)),
  } as unknown as Response
}

afterEach(() => {
  delete (globalThis as { fetch?: typeof fetch }).fetch
})

describe('login', () => {
  it('POSTs the password and resolves with the status', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'ok' }))

    const result = await login('hunter2')

    expect(result).toEqual({ status: 'ok' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/login')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ password: 'hunter2' }))
  })

  it('rejects on a wrong password (401)', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Invalid password' }))

    await expect(login('wrong')).rejects.toMatchObject({ status: 401 })
  })
})

describe('logout', () => {
  it('POSTs to /auth/logout', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'ok' }))

    const result = await logout()

    expect(result).toEqual({ status: 'ok' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/logout')
    expect(init?.method).toBe('POST')
  })
})
