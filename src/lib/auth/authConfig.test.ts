import {
  LOADING_CONFIG,
  UNKNOWN_CONFIG,
  googleClientIdOf,
  knownConfig,
  modeOfConfigState,
  parseAuthConfig,
  sameConfigState,
} from './authConfig.ts'

describe('parseAuthConfig', () => {
  it('reads a server with Google login on', () => {
    expect(parseAuthConfig({ methods: [{ type: 'google', clientId: 'id.apps.googleusercontent.com' }] })).toEqual({
      methods: [{ type: 'google', clientId: 'id.apps.googleusercontent.com' }],
    })
  })

  it('reads a server with login off (no methods)', () => {
    expect(parseAuthConfig({ methods: [] })).toEqual({ methods: [] })
  })

  it('ignores method types it does not know, keeping the ones it does', () => {
    const parsed = parseAuthConfig({
      methods: [{ type: 'passkey', rpId: 'x' }, { type: 'google', clientId: 'id' }, 'weird', null, 7],
    })
    expect(parsed).toEqual({ methods: [{ type: 'google', clientId: 'id' }] })
  })

  it('keeps the usable method when it comes with a malformed google one', () => {
    expect(parseAuthConfig({ methods: [{ type: 'google' }, { type: 'google', clientId: 'ok' }] })).toEqual({
      methods: [{ type: 'google', clientId: 'ok' }],
    })
  })

  it('is unknown (null), never "off", when methods are listed but none is usable (only unknown types)', () => {
    expect(parseAuthConfig({ methods: [{ type: 'passkey' }] })).toBeNull()
  })

  it.each([
    ['no client ID', { type: 'google' }],
    ['a blank client ID', { type: 'google', clientId: '  ' }],
    ['a non-string client ID', { type: 'google', clientId: 5 }],
  ])('is unknown (null), not "off", when the only google method has %s', (_label, method) => {
    expect(parseAuthConfig({ methods: [method] })).toBeNull()
  })

  it('is unknown (null) when every listed method is garbage', () => {
    expect(parseAuthConfig({ methods: ['x', null, 3, {}] })).toBeNull()
  })

  it('trims the client ID', () => {
    expect(parseAuthConfig({ methods: [{ type: 'google', clientId: ' id ' }] })).toEqual({
      methods: [{ type: 'google', clientId: 'id' }],
    })
  })

  it.each([null, undefined, 'ok', 5, [], {}, { methods: 'google' }, { methods: null }, { methods: {} }])(
    'is null (unknown) for a malformed body: %j',
    (body) => {
      expect(parseAuthConfig(body)).toBeNull()
    },
  )
})

describe('googleClientIdOf', () => {
  it('is the Google method\'s client ID', () => {
    expect(googleClientIdOf({ methods: [{ type: 'google', clientId: 'id' }] })).toBe('id')
  })

  it('is null when there is no Google method', () => {
    expect(googleClientIdOf({ methods: [] })).toBeNull()
  })
})

describe('modeOfConfigState', () => {
  it.each([
    [LOADING_CONFIG, 'loading'],
    [UNKNOWN_CONFIG, 'unknown'],
    [knownConfig({ methods: [] }), 'none'],
    [knownConfig({ methods: [{ type: 'google', clientId: 'id' }] }), 'google'],
  ] as const)('%j -> %s', (state, mode) => {
    expect(modeOfConfigState(state)).toBe(mode)
  })
})

describe('sameConfigState', () => {
  it('is true for equal states, so a re-fetch of an unchanged config changes nothing', () => {
    const a = knownConfig({ methods: [{ type: 'google', clientId: 'id' }] })
    const b = knownConfig({ methods: [{ type: 'google', clientId: 'id' }] })
    expect(sameConfigState(a, b)).toBe(true)
    expect(sameConfigState(UNKNOWN_CONFIG, UNKNOWN_CONFIG)).toBe(true)
  })

  it('is false when the status or the methods differ', () => {
    expect(sameConfigState(LOADING_CONFIG, UNKNOWN_CONFIG)).toBe(false)
    expect(sameConfigState(knownConfig({ methods: [] }), UNKNOWN_CONFIG)).toBe(false)
    expect(
      sameConfigState(knownConfig({ methods: [] }), knownConfig({ methods: [{ type: 'google', clientId: 'id' }] })),
    ).toBe(false)
    expect(
      sameConfigState(
        knownConfig({ methods: [{ type: 'google', clientId: 'a' }] }),
        knownConfig({ methods: [{ type: 'google', clientId: 'b' }] }),
      ),
    ).toBe(false)
  })
})
