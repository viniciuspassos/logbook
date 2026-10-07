import { getAuthConfig, getMe, loginWithGoogle, logout } from './authApi.ts'

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

describe('loginWithGoogle', () => {
  it('POSTs the ID token to /auth/google and resolves with the status', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'ok' }))

    const result = await loginWithGoogle('google-id-token')

    expect(result).toEqual({ status: 'ok' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/google')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ idToken: 'google-id-token' }))
  })

  it('sends X-Logbook-Client: web (login-CSRF protection) and a JSON content type', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'ok' }))

    await loginWithGoogle('google-id-token')

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['X-Logbook-Client']).toBe('web')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('does not send that header on any other auth call', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'u', email: 'a@b.co', name: null, picture: null }))
    await getMe()
    fetchMock.mockResolvedValue(jsonResponse(200, { methods: [] }))
    await getAuthConfig()
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'ok' }))
    await logout()

    for (const [, init] of fetchMock.mock.calls) {
      expect((init?.headers as Record<string, string>)['X-Logbook-Client']).toBeUndefined()
    }
  })

  it('rejects with the status when the token is rejected (401) or the account is not allowed (403)', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Invalid token' }))
    await expect(loginWithGoogle('bad')).rejects.toMatchObject({ status: 401 })

    fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: 'Not allowed' }))
    await expect(loginWithGoogle('nope')).rejects.toMatchObject({ status: 403 })
  })
})

describe('getMe', () => {
  it('GETs /auth/me and resolves with the profile', async () => {
    const fetchMock = installFetch()
    const profile = { id: 'u1', email: 'a@b.co', name: 'Ada', picture: null }
    fetchMock.mockResolvedValue(jsonResponse(200, profile))

    await expect(getMe()).resolves.toEqual(profile)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/me')
    expect(init?.method).toBe('GET')
  })

  it('accepts a numeric id and passes the abort signal through', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 7, email: 'a@b.co', name: null, picture: 'https://x/y.png' }))
    const controller = new AbortController()

    await expect(getMe(controller.signal)).resolves.toMatchObject({ id: 7 })
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal)
  })

  it('rejects with a 401 when there is no session', async () => {
    installFetch().mockResolvedValue(jsonResponse(401, { message: 'Unauthorized' }))
    await expect(getMe()).rejects.toMatchObject({ status: 401 })
  })

  it.each([
    ['null', null],
    ['a string', 'ok'],
    ['a missing email', { id: 1, name: null, picture: null }],
    ['a bad id', { id: true, email: 'a@b.co', name: null, picture: null }],
    ['a numeric name', { id: 1, email: 'a@b.co', name: 5, picture: null }],
  ])('rejects a malformed profile (%s) instead of trusting it', async (_label, body) => {
    installFetch().mockResolvedValue(jsonResponse(200, body))
    await expect(getMe()).rejects.toThrow('Unexpected response')
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

describe('getAuthConfig', () => {
  it('GETs /auth/config and resolves with the server\'s login methods', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(200, { methods: [{ type: 'google', clientId: 'id.apps.googleusercontent.com' }] }))

    await expect(getAuthConfig()).resolves.toEqual({
      methods: [{ type: 'google', clientId: 'id.apps.googleusercontent.com' }],
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/config')
    expect(init?.method).toBe('GET')
  })

  it('resolves with no methods when login is off on the server', async () => {
    installFetch().mockResolvedValue(jsonResponse(200, { methods: [] }))
    await expect(getAuthConfig()).resolves.toEqual({ methods: [] })
  })

  it('is unknown (null), not "off", when it lists only methods it does not know', async () => {
    installFetch().mockResolvedValue(jsonResponse(200, { methods: [{ type: 'passkey' }] }))
    await expect(getAuthConfig()).resolves.toBeNull()
  })

  it('passes the abort signal through', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(200, { methods: [] }))
    const controller = new AbortController()

    await getAuthConfig(controller.signal)

    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal)
  })

  it.each([
    ['a 404 (an older server)', jsonResponse(404, { message: 'Not Found' })],
    ['a 500', jsonResponse(500, { message: 'boom' })],
    ['a 401', jsonResponse(401, { message: 'no' })],
    ['a malformed body', jsonResponse(200, { methods: 'google' })],
    ['a non-object body', jsonResponse(200, 'ok')],
  ])('is null (unknown), never a throw, for %s', async (_label, response) => {
    installFetch().mockResolvedValue(response)
    await expect(getAuthConfig()).resolves.toBeNull()
  })

  it('is null when the server cannot be reached', async () => {
    installFetch().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(getAuthConfig()).resolves.toBeNull()
  })

  it('is null when there is no fetch at all', async () => {
    await expect(getAuthConfig()).resolves.toBeNull()
  })
})
