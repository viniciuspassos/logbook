import {
  clampButtonWidth,
  SCRIPT_LOAD_TIMEOUT_MS,
  disableGoogleAutoSelect,
  preferredButtonTheme,
  renderGoogleSignInButton,
} from './googleIdentity.ts'

type GoogleGlobal = { google?: unknown }

interface FakeGis {
  initialize: jest.Mock
  renderButton: jest.Mock
  disableAutoSelect: jest.Mock
}

function installGoogle(): FakeGis {
  const id: FakeGis = {
    initialize: jest.fn(),
    renderButton: jest.fn(),
    disableAutoSelect: jest.fn(),
  }
  ;(globalThis as GoogleGlobal).google = { accounts: { id } }
  return id
}

function gsiScript(): HTMLScriptElement | null {
  return document.head.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client?hl=en"]')
}

beforeEach(() => {
  window.__LOGBOOK_GOOGLE_CLIENT_ID__ = 'client-id.apps.googleusercontent.com'
})

afterEach(() => {
  delete (globalThis as GoogleGlobal).google
  delete window.__LOGBOOK_GOOGLE_CLIENT_ID__
  document.head.innerHTML = ''
})

describe('clampButtonWidth', () => {
  it.each([
    [0, 280],
    [150, 200],
    [320.4, 320],
    [900, 400],
  ])('%d -> %d', (input, expected) => {
    expect(clampButtonWidth(input)).toBe(expected)
  })
})

describe('preferredButtonTheme', () => {
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('is outline when matchMedia is unavailable (jsdom)', () => {
    expect(preferredButtonTheme()).toBe('outline')
  })

  it('is filled_black in dark mode', () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: true })
    expect(preferredButtonTheme()).toBe('filled_black')
  })

  it('is outline in light mode', () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: false })
    expect(preferredButtonTheme()).toBe('outline')
  })
})

describe('renderGoogleSignInButton', () => {
  it('is unavailable (no-client-id) without touching the network when no client ID is configured', async () => {
    delete window.__LOGBOOK_GOOGLE_CLIENT_ID__
    const result = await renderGoogleSignInButton(document.createElement('div'), {
      onCredential: jest.fn(),
    })
    expect(result).toEqual({ status: 'unavailable', reason: 'no-client-id' })
    expect(gsiScript()).toBeNull()
  })

  it('initializes GIS and renders the button when the global already exists', async () => {
    const gis = installGoogle()
    const container = document.createElement('div')

    const result = await renderGoogleSignInButton(container, { onCredential: jest.fn() })

    expect(result).toEqual({ status: 'rendered' })
    expect(gis.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'client-id.apps.googleusercontent.com', auto_select: false }),
    )
    expect(gis.renderButton).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ text: 'continue_with', locale: 'en', width: 280 }),
    )
    expect(gsiScript()).toBeNull()
  })

  it('initializes GIS once, and credentials go to the most recently rendered button', async () => {
    const gis = installGoogle()
    const first = jest.fn()
    const second = jest.fn()
    await renderGoogleSignInButton(document.createElement('div'), { onCredential: first })
    await renderGoogleSignInButton(document.createElement('div'), { onCredential: second })

    expect(gis.initialize).toHaveBeenCalledTimes(1)
    expect(gis.renderButton).toHaveBeenCalledTimes(2)
    gis.initialize.mock.calls[0][0].callback({ credential: 'tok' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('tok')
  })

  it('forwards the ID token from the GIS callback', async () => {
    const gis = installGoogle()
    const onCredential = jest.fn()
    await renderGoogleSignInButton(document.createElement('div'), { onCredential })

    gis.initialize.mock.calls[0][0].callback({ credential: 'id-token' })

    expect(onCredential).toHaveBeenCalledWith('id-token')
  })

  it('ignores a callback without a usable credential', async () => {
    const gis = installGoogle()
    const onCredential = jest.fn()
    await renderGoogleSignInButton(document.createElement('div'), { onCredential })

    gis.initialize.mock.calls[0][0].callback({})
    gis.initialize.mock.calls[0][0].callback({ credential: '' })

    expect(onCredential).not.toHaveBeenCalled()
  })

  it('ignores a credential that arrives after the signal aborted', async () => {
    const gis = installGoogle()
    const onCredential = jest.fn()
    const controller = new AbortController()
    await renderGoogleSignInButton(document.createElement('div'), { onCredential, signal: controller.signal })

    controller.abort()
    gis.initialize.mock.calls[0][0].callback({ credential: 'late' })

    expect(onCredential).not.toHaveBeenCalled()
  })

  it('lazy-loads the GIS script, then renders once it has loaded', async () => {
    const container = document.createElement('div')
    const pending = renderGoogleSignInButton(container, { onCredential: jest.fn() })

    const script = gsiScript()
    expect(script).not.toBeNull()
    const gis = installGoogle()
    script?.onload?.(new Event('load'))

    await expect(pending).resolves.toEqual({ status: 'rendered' })
    expect(gis.renderButton).toHaveBeenCalled()
  })

  it('shares one script tag between concurrent callers', async () => {
    const first = renderGoogleSignInButton(document.createElement('div'), { onCredential: jest.fn() })
    const second = renderGoogleSignInButton(document.createElement('div'), { onCredential: jest.fn() })

    expect(document.head.querySelectorAll('script')).toHaveLength(1)
    installGoogle()
    gsiScript()?.onload?.(new Event('load'))
    await Promise.all([first, second])
  })

  it('is unavailable (offline) when the script fails to load, and a retry injects a fresh tag', async () => {
    const pending = renderGoogleSignInButton(document.createElement('div'), { onCredential: jest.fn() })
    gsiScript()?.onerror?.(new Event('error'))

    await expect(pending).resolves.toEqual({ status: 'unavailable', reason: 'offline' })
    expect(gsiScript()).toBeNull()

    const retry = renderGoogleSignInButton(document.createElement('div'), { onCredential: jest.fn() })
    expect(gsiScript()).not.toBeNull()
    gsiScript()?.onerror?.(new Event('error'))
    await retry
  })

  describe('when the request stalls (neither load nor error)', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('gives up after the load timeout: unavailable (offline), stale tag removed', async () => {
      const pending = renderGoogleSignInButton(document.createElement('div'), { onCredential: jest.fn() })
      expect(gsiScript()).not.toBeNull()

      await jest.advanceTimersByTimeAsync(SCRIPT_LOAD_TIMEOUT_MS)

      await expect(pending).resolves.toEqual({ status: 'unavailable', reason: 'offline' })
      expect(gsiScript()).toBeNull()
    })

    it('lets a retry inject a fresh script instead of reusing the dead load', async () => {
      const first = renderGoogleSignInButton(document.createElement('div'), { onCredential: jest.fn() })
      await jest.advanceTimersByTimeAsync(SCRIPT_LOAD_TIMEOUT_MS)
      await first

      const retry = renderGoogleSignInButton(document.createElement('div'), { onCredential: jest.fn() })
      const gis = installGoogle()
      expect(gsiScript()).not.toBeNull()
      gsiScript()?.onload?.(new Event('load'))

      await expect(retry).resolves.toEqual({ status: 'rendered' })
      expect(gis.renderButton).toHaveBeenCalled()
    })

    it('does not fire the timeout after a normal load', async () => {
      const pending = renderGoogleSignInButton(document.createElement('div'), { onCredential: jest.fn() })
      installGoogle()
      gsiScript()?.onload?.(new Event('load'))
      await pending

      expect(jest.getTimerCount()).toBe(0)
    })
  })

  it('is unavailable when the script loads but defines no google global', async () => {
    const pending = renderGoogleSignInButton(document.createElement('div'), { onCredential: jest.fn() })
    gsiScript()?.onload?.(new Event('load'))

    await expect(pending).resolves.toEqual({ status: 'unavailable', reason: 'offline' })
  })

  it('is cancelled when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await renderGoogleSignInButton(document.createElement('div'), {
      onCredential: jest.fn(),
      signal: controller.signal,
    })
    expect(result).toEqual({ status: 'cancelled' })
  })

  it('is cancelled when the signal aborts while the script is loading, and renders nothing', async () => {
    const controller = new AbortController()
    const pending = renderGoogleSignInButton(document.createElement('div'), {
      onCredential: jest.fn(),
      signal: controller.signal,
    })

    controller.abort()
    await expect(pending).resolves.toEqual({ status: 'cancelled' })

    const gis = installGoogle()
    gsiScript()?.onload?.(new Event('load'))
    await Promise.resolve()
    expect(gis.renderButton).not.toHaveBeenCalled()
  })
})

describe('disableGoogleAutoSelect', () => {
  it('is a no-op when GIS never loaded', () => {
    expect(() => disableGoogleAutoSelect()).not.toThrow()
  })

  it('asks GIS to stop auto-selecting the last account', () => {
    const gis = installGoogle()
    disableGoogleAutoSelect()
    expect(gis.disableAutoSelect).toHaveBeenCalledTimes(1)
  })

  it('swallows a GIS failure', () => {
    const gis = installGoogle()
    gis.disableAutoSelect.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => disableGoogleAutoSelect()).not.toThrow()
  })
})
