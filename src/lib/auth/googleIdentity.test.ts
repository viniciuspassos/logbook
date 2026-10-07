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

const CLIENT_ID = 'client-id.apps.googleusercontent.com'

afterEach(() => {
  delete (globalThis as GoogleGlobal).google
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
  it('is unavailable (no-client-id) without touching the network when the server gave no client ID', async () => {
    const result = await renderGoogleSignInButton(document.createElement('div'), {
      clientId: null,
      onCredential: jest.fn(),
    })
    expect(result).toEqual({ status: 'unavailable', reason: 'no-client-id' })
    expect(gsiScript()).toBeNull()
  })

  it('initializes GIS and renders the button when the global already exists', async () => {
    const gis = installGoogle()
    const container = document.createElement('div')

    const result = await renderGoogleSignInButton(container, { clientId: CLIENT_ID, onCredential: jest.fn() })

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
    await renderGoogleSignInButton(document.createElement('div'), { clientId: CLIENT_ID, onCredential: first })
    await renderGoogleSignInButton(document.createElement('div'), { clientId: CLIENT_ID, onCredential: second })

    expect(gis.initialize).toHaveBeenCalledTimes(1)
    expect(gis.renderButton).toHaveBeenCalledTimes(2)
    gis.initialize.mock.calls[0][0].callback({ credential: 'tok' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('tok')
  })

  it('forwards the ID token from the GIS callback', async () => {
    const gis = installGoogle()
    const onCredential = jest.fn()
    await renderGoogleSignInButton(document.createElement('div'), { clientId: CLIENT_ID, onCredential })

    gis.initialize.mock.calls[0][0].callback({ credential: 'id-token' })

    expect(onCredential).toHaveBeenCalledWith('id-token')
  })

  it('ignores a callback without a usable credential', async () => {
    const gis = installGoogle()
    const onCredential = jest.fn()
    await renderGoogleSignInButton(document.createElement('div'), { clientId: CLIENT_ID, onCredential })

    gis.initialize.mock.calls[0][0].callback({})
    gis.initialize.mock.calls[0][0].callback({ credential: '' })

    expect(onCredential).not.toHaveBeenCalled()
  })

  it('ignores a credential that arrives after the signal aborted', async () => {
    const gis = installGoogle()
    const onCredential = jest.fn()
    const controller = new AbortController()
    await renderGoogleSignInButton(document.createElement('div'), { clientId: CLIENT_ID, onCredential, signal: controller.signal })

    controller.abort()
    gis.initialize.mock.calls[0][0].callback({ credential: 'late' })

    expect(onCredential).not.toHaveBeenCalled()
  })

  it('lazy-loads the GIS script, then renders once it has loaded', async () => {
    const container = document.createElement('div')
    const pending = renderGoogleSignInButton(container, { clientId: CLIENT_ID, onCredential: jest.fn() })

    const script = gsiScript()
    expect(script).not.toBeNull()
    const gis = installGoogle()
    script?.dispatchEvent(new Event('load'))

    await expect(pending).resolves.toEqual({ status: 'rendered' })
    expect(gis.renderButton).toHaveBeenCalled()
  })

  it('shares one script tag between concurrent callers', async () => {
    const first = renderGoogleSignInButton(document.createElement('div'), { clientId: CLIENT_ID, onCredential: jest.fn() })
    const second = renderGoogleSignInButton(document.createElement('div'), { clientId: CLIENT_ID, onCredential: jest.fn() })

    expect(document.head.querySelectorAll('script')).toHaveLength(1)
    installGoogle()
    gsiScript()?.dispatchEvent(new Event('load'))
    await Promise.all([first, second])
  })

  it('is unavailable (offline) when the script fails to load, and a retry injects a fresh tag', async () => {
    const pending = renderGoogleSignInButton(document.createElement('div'), { clientId: CLIENT_ID, onCredential: jest.fn() })
    gsiScript()?.dispatchEvent(new Event('error'))

    await expect(pending).resolves.toEqual({ status: 'unavailable', reason: 'offline' })
    expect(gsiScript()).toBeNull()

    const retry = renderGoogleSignInButton(document.createElement('div'), { clientId: CLIENT_ID, onCredential: jest.fn() })
    expect(gsiScript()).not.toBeNull()
    gsiScript()?.dispatchEvent(new Event('error'))
    await retry
  })

  describe('when the request stalls (neither load nor error)', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    function render(onCredential = jest.fn()) {
      return renderGoogleSignInButton(document.createElement('div'), { clientId: CLIENT_ID, onCredential })
    }

    it('gives up after the load timeout: unavailable (offline), and the tag stays, since its request may still finish', async () => {
      const pending = render()
      expect(gsiScript()).not.toBeNull()

      await jest.advanceTimersByTimeAsync(SCRIPT_LOAD_TIMEOUT_MS)

      await expect(pending).resolves.toEqual({ status: 'unavailable', reason: 'offline' })
      expect(gsiScript()).not.toBeNull()
    })

    it('lets a retry reuse the pending tag (no second script), with a fresh timeout', async () => {
      const first = render()
      await jest.advanceTimersByTimeAsync(SCRIPT_LOAD_TIMEOUT_MS)
      await first

      const retry = render()
      expect(document.head.querySelectorAll('script')).toHaveLength(1)
      const gis = installGoogle()
      gsiScript()?.dispatchEvent(new Event('load'))

      await expect(retry).resolves.toEqual({ status: 'rendered' })
      expect(gis.renderButton).toHaveBeenCalledTimes(1)
    })

    it('times out the retry too if the reused tag is still stalled', async () => {
      await jest.advanceTimersByTimeAsync(0)
      const first = render()
      await jest.advanceTimersByTimeAsync(SCRIPT_LOAD_TIMEOUT_MS)
      await first

      const retry = render()
      await jest.advanceTimersByTimeAsync(SCRIPT_LOAD_TIMEOUT_MS)

      await expect(retry).resolves.toEqual({ status: 'unavailable', reason: 'offline' })
      expect(document.head.querySelectorAll('script')).toHaveLength(1)
    })

    it('uses the global when the stalled request finishes after the timeout, with no new tag', async () => {
      const first = render()
      await jest.advanceTimersByTimeAsync(SCRIPT_LOAD_TIMEOUT_MS)
      await first

      const gis = installGoogle()
      gsiScript()?.dispatchEvent(new Event('load'))
      const retry = render()

      await expect(retry).resolves.toEqual({ status: 'rendered' })
      expect(gis.renderButton).toHaveBeenCalledTimes(1)
      expect(document.head.querySelectorAll('script')).toHaveLength(1)
    })

    it('removes a stalled tag that later errors, so the next retry injects a fresh one', async () => {
      const first = render()
      await jest.advanceTimersByTimeAsync(SCRIPT_LOAD_TIMEOUT_MS)
      await first

      gsiScript()?.dispatchEvent(new Event('error'))
      expect(gsiScript()).toBeNull()

      const retry = render()
      expect(gsiScript()).not.toBeNull()
      gsiScript()?.dispatchEvent(new Event('error'))
      await retry
    })

    it('delivers a credential once, even if the script fires load twice', async () => {
      const onCredential = jest.fn()
      const pending = render(onCredential)
      const gis = installGoogle()
      gsiScript()?.dispatchEvent(new Event('load'))
      gsiScript()?.dispatchEvent(new Event('load'))
      await pending

      gis.initialize.mock.calls[0][0].callback({ credential: 'tok' })

      expect(gis.initialize).toHaveBeenCalledTimes(1)
      expect(onCredential).toHaveBeenCalledTimes(1)
    })

    it('does not fire the timeout after a normal load', async () => {
      const pending = render()
      installGoogle()
      gsiScript()?.dispatchEvent(new Event('load'))
      await pending

      expect(jest.getTimerCount()).toBe(0)
    })
  })

  it('uses the first client ID for the page lifetime: GIS is initialized once', async () => {
    const gis = installGoogle()
    const div = () => document.createElement('div')
    await renderGoogleSignInButton(div(), { clientId: 'one', onCredential: jest.fn() })
    await renderGoogleSignInButton(div(), { clientId: 'two', onCredential: jest.fn() })

    expect(gis.initialize).toHaveBeenCalledTimes(1)
    expect(gis.initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'one' }))
  })

  it('is unavailable when the script loads but defines no google global', async () => {
    const pending = renderGoogleSignInButton(document.createElement('div'), { clientId: CLIENT_ID, onCredential: jest.fn() })
    gsiScript()?.dispatchEvent(new Event('load'))

    await expect(pending).resolves.toEqual({ status: 'unavailable', reason: 'offline' })
    expect(gsiScript()).toBeNull()
  })

  it('is cancelled when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await renderGoogleSignInButton(document.createElement('div'), {
      clientId: CLIENT_ID,
      onCredential: jest.fn(),
      signal: controller.signal,
    })
    expect(result).toEqual({ status: 'cancelled' })
  })

  it('is cancelled when the signal aborts while the script is loading, and renders nothing', async () => {
    const controller = new AbortController()
    const pending = renderGoogleSignInButton(document.createElement('div'), {
      clientId: CLIENT_ID,
      onCredential: jest.fn(),
      signal: controller.signal,
    })

    controller.abort()
    await expect(pending).resolves.toEqual({ status: 'cancelled' })

    const gis = installGoogle()
    gsiScript()?.dispatchEvent(new Event('load'))
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
