import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.tsx'
import { entries } from './data/entries.ts'
import { subscribeToDrains } from './lib/sync/outboxRunner.ts'
import { getAuthConfig, getMe, loginWithGoogle } from './lib/sync/authApi.ts'
import { getCachedIdentity } from './lib/db/identityStore.ts'
import { hasLocalData } from './lib/db/localOwner.ts'
import { renderGoogleSignInButton } from './lib/auth/googleIdentity.ts'
import { SyncAuthError, SyncNetworkError } from './lib/sync/errors.ts'

// The real runner, with subscribeToDrains wrapped so a test can hand a drain
// outcome straight to whoever subscribed.
jest.mock('./lib/sync/outboxRunner.ts', () => {
  const actual = jest.requireActual('./lib/sync/outboxRunner.ts')
  return { ...actual, subscribeToDrains: jest.fn(actual.subscribeToDrains) }
})

// Only the sign-in gate tests below run the real useAuth; every other test
// runs under the mocked flag, which skips the gate (see useAuth.ts).
jest.mock('./lib/sync/authApi.ts', () => ({
  getAuthConfig: jest.fn(),
  getMe: jest.fn(),
  loginWithGoogle: jest.fn(),
  logout: jest.fn().mockResolvedValue({ status: 'ok' }),
}))
jest.mock('./lib/db/identityStore.ts', () => ({
  getCachedIdentity: jest.fn().mockResolvedValue(null),
  putCachedIdentity: jest.fn().mockResolvedValue(undefined),
  clearCachedIdentity: jest.fn().mockResolvedValue(undefined),
  getCachedAuthConfig: jest.fn().mockResolvedValue(null),
  putCachedAuthConfig: jest.fn().mockResolvedValue(undefined),
  hasPendingLogout: jest.fn().mockResolvedValue(false),
  setPendingLogout: jest.fn().mockResolvedValue(undefined),
  clearPendingLogout: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('./lib/db/localOwner.ts', () => ({
  checkLocalOwner: jest.fn().mockResolvedValue('ok'),
  claimLocalData: jest.fn().mockResolvedValue(undefined),
  hasLocalData: jest.fn().mockResolvedValue(false),
}))
jest.mock('./lib/auth/googleIdentity.ts', () => ({
  renderGoogleSignInButton: jest.fn().mockResolvedValue({ status: 'rendered' }),
  disableGoogleAutoSelect: jest.fn(),
}))

// This suite exercises the real App -> useLogbookApp -> useEntries path and
// asserts against the sample entries' titles/ids, so it needs the same
// seeding `npm run dev:mocked` provides via vite.config.ts's `define` — see
// src/lib/config/mockData.ts.
beforeAll(() => {
  globalThis.__LOGBOOK_MOCKED__ = true
})

afterAll(() => {
  delete (globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__
})

describe('App', () => {
  it('starts on the Timeline tab showing every entry', () => {
    render(<App />)
    expect(screen.getByText('Logbook')).toBeInTheDocument()
    for (const entry of entries) {
      expect(screen.getByText(entry.title)).toBeInTheDocument()
    }
  })

  it('shows how the latest sync went in the timeline header', () => {
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('Saved locally')

    const listener = (subscribeToDrains as jest.Mock).mock.calls.at(-1)?.[0]
    act(() => listener({ processed: 1, stoppedReason: 'empty' }))
    expect(screen.getByRole('status')).toHaveTextContent('Saved locally · synced')
  })

  it('navigates between tabs and hides the tab bar behind an overlay', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /stats/i }))
    expect(screen.getByText('By activity')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.getByText('Version')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /search/i }))
    expect(screen.getByRole('searchbox')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /timeline/i }))
    expect(screen.getByText('Saved locally')).toBeInTheDocument()
  })

  it('opens an entry from the timeline and can navigate back', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByText(entries[0].title))
    expect(screen.getByText(entries[0].story)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new entry/i })).not.toBeInTheDocument()

    await user.click(screen.getByText('‹'))
    expect(screen.queryByText(entries[0].story)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new entry/i })).toBeInTheDocument()
  })

  it('deletes an entry from its detail view and returns to the timeline without it', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByText(entries[0].title))
    await user.click(screen.getByRole('button', { name: 'Delete entry' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.queryByText(entries[0].title)).not.toBeInTheDocument()
    expect(screen.getByText(entries[1].title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new entry/i })).toBeInTheDocument()
  })

  it('creates an entry through the type-to-extract flow', async () => {
    // Speech and on-device AI are unavailable under jsdom, so this drives the
    // typed-notes path, which lands on the manual review + editable story.
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /new entry/i }))
    expect(screen.getByText('New entry')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Type instead' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Adventure notes' }),
      'Sunset trail run today',
    )
    await user.click(screen.getByRole('button', { name: 'Extract details' }))

    expect(await screen.findByText('Manual entry')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    expect(await screen.findByText('Saved locally')).toBeInTheDocument()
    // Appears as both the new card's title and its derived excerpt.
    expect(screen.getAllByText('Sunset trail run today').length).toBeGreaterThan(0)
  })

  describe('desktop reading panel', () => {
    const originalMatchMedia = window.matchMedia

    beforeEach(() => {
      window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia
    })

    afterEach(() => {
      if (originalMatchMedia) {
        window.matchMedia = originalMatchMedia
      } else {
        // jsdom has no matchMedia by default; restore that absence.
        delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia
      }
    })

    it('shows the most recently created entry read-only instead of the static hint', () => {
      render(<App />)
      const mostRecent = [...entries].sort((a, b) => b.id - a.id)[0]
      expect(screen.getByText(mostRecent.story)).toBeInTheDocument()
      // Read-only: no back button, since it isn't a modal over anything.
      expect(screen.queryByText('‹')).not.toBeInTheDocument()
      expect(screen.queryByText('Open an entry to read it here')).not.toBeInTheDocument()
    })

    it('marks the list row of whichever entry the reading panel shows', async () => {
      const user = userEvent.setup()
      render(<App />)
      const [mostRecent, , older] = [...entries].sort((a, b) => b.id - a.id)
      expect(screen.getByRole('button', { current: true })).toHaveTextContent(mostRecent.title)

      await user.click(screen.getByRole('button', { name: new RegExp(older.title) }))
      expect(screen.getByRole('button', { current: true })).toHaveTextContent(older.title)
    })

    it('marks no list row while the panel shows the new-entry form', async () => {
      const user = userEvent.setup()
      render(<App />)
      await user.click(screen.getByRole('button', { name: 'New entry' }))
      expect(screen.queryByRole('button', { current: true })).not.toBeInTheDocument()
    })
  })

  describe('sign-in gate', () => {
    const ada = { id: 'u1', email: 'ada@example.com', name: 'Ada', picture: null }

    function emitDrain(summary: object) {
      const listeners = (subscribeToDrains as jest.Mock).mock.calls.map((call) => call[0])
      act(() => listeners.forEach((listener) => listener(summary)))
    }

    beforeEach(() => {
      delete (globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__
      ;(getCachedIdentity as jest.Mock).mockResolvedValue(null)
      ;(hasLocalData as jest.Mock).mockResolvedValue(false)
      ;(getMe as jest.Mock).mockRejectedValue(new SyncAuthError(401, null))
      ;(getAuthConfig as jest.Mock).mockResolvedValue({
        methods: [{ type: 'google', clientId: 'cid.apps.googleusercontent.com' }],
      })
    })

    afterEach(() => {
      globalThis.__LOGBOOK_MOCKED__ = true
    })

    it('shows the login screen, not the app, when there is no known identity', async () => {
      render(<App />)

      expect(await screen.findByRole('heading', { name: 'Logbook', level: 1 })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /new entry/i })).not.toBeInTheDocument()
      await act(async () => {})
    })

    it('opens the app after signing in with Google', async () => {
      const user = userEvent.setup()
      ;(loginWithGoogle as jest.Mock).mockResolvedValue({ status: 'ok' })
      render(<App />)
      await screen.findByRole('heading', { name: 'Logbook', level: 1 })

      ;(getMe as jest.Mock).mockResolvedValue(ada)
      const options = (renderGoogleSignInButton as jest.Mock).mock.calls.at(-1)?.[1]
      await act(async () => options.onCredential('id-token'))

      expect(await screen.findByRole('button', { name: /new entry/i })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /settings/i }))
      expect(screen.getByText('ada@example.com')).toBeInTheDocument()
      await act(async () => {})
    })

    it('opens the app offline from the cached identity', async () => {
      ;(getCachedIdentity as jest.Mock).mockResolvedValue(ada)
      ;(getMe as jest.Mock).mockRejectedValue(new SyncNetworkError())
      render(<App />)

      expect(await screen.findByRole('button', { name: /new entry/i })).toBeInTheDocument()
      await act(async () => {})
    })

    it('opens the app offline for an existing user who has local entries but no cached identity', async () => {
      ;(hasLocalData as jest.Mock).mockResolvedValue(true)
      ;(getMe as jest.Mock).mockRejectedValue(new SyncNetworkError())
      render(<App />)

      expect(await screen.findByRole('button', { name: /new entry/i })).toBeInTheDocument()
      await act(async () => {})
    })

    it('brings the gate back when the session is rejected at startup, even with a cached identity', async () => {
      ;(getCachedIdentity as jest.Mock).mockResolvedValue(ada)
      render(<App />)

      expect(await screen.findByRole('heading', { name: 'Logbook', level: 1 })).toBeInTheDocument()
      await act(async () => {})
    })

    it('keeps the app mounted, with a banner, when a background sync finds the session gone', async () => {
      const user = userEvent.setup()
      ;(getMe as jest.Mock).mockResolvedValue(ada)
      render(<App />)
      await user.click(await screen.findByRole('button', { name: /new entry/i }))
      await user.click(screen.getByRole('button', { name: 'Type instead' }))
      await user.type(screen.getByRole('textbox', { name: 'Adventure notes' }), 'Half-written draft')

      emitDrain({ processed: 0, stoppedReason: 'auth' })

      expect(await screen.findByText('Sign in again to resume syncing.')).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Adventure notes' })).toHaveValue('Half-written draft')
      await act(async () => {})
    })

    it('signs in again from the banner over the running app, then drops the banner', async () => {
      const user = userEvent.setup()
      ;(getMe as jest.Mock).mockResolvedValue(ada)
      ;(loginWithGoogle as jest.Mock).mockResolvedValue({ status: 'ok' })
      render(<App />)
      await screen.findByRole('button', { name: /new entry/i })
      emitDrain({ processed: 0, stoppedReason: 'auth' })

      await user.click(await screen.findByRole('button', { name: 'Sign in' }))
      expect(screen.getByText('Record climbs and jumps, even with no signal.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /new entry/i })).toBeInTheDocument()

      const options = (renderGoogleSignInButton as jest.Mock).mock.calls.at(-1)?.[1]
      await act(async () => options.onCredential('id-token'))

      expect(screen.queryByText('Sign in again to resume syncing.')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument()
      await act(async () => {})
    })

    it('after signing in again, a second background 401 shows only the banner, not the full-screen sign-in', async () => {
      const user = userEvent.setup()
      ;(getMe as jest.Mock).mockResolvedValue(ada)
      ;(loginWithGoogle as jest.Mock).mockResolvedValue({ status: 'ok' })
      render(<App />)
      await screen.findByRole('button', { name: /new entry/i })
      emitDrain({ processed: 0, stoppedReason: 'auth' })
      await user.click(await screen.findByRole('button', { name: 'Sign in' }))
      const options = (renderGoogleSignInButton as jest.Mock).mock.calls.at(-1)?.[1]
      await act(async () => options.onCredential('id-token'))
      expect(screen.queryByText('Sign in again to resume syncing.')).not.toBeInTheDocument()

      emitDrain({ processed: 0, stoppedReason: 'auth' })

      expect(await screen.findByText('Sign in again to resume syncing.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument()
      await act(async () => {})
    })

    it('lets the user dismiss the sign-in screen opened from the banner', async () => {
      const user = userEvent.setup()
      ;(getMe as jest.Mock).mockResolvedValue(ada)
      render(<App />)
      await screen.findByRole('button', { name: /new entry/i })
      emitDrain({ processed: 0, stoppedReason: 'auth' })

      await user.click(await screen.findByRole('button', { name: 'Sign in' }))
      await user.click(screen.getByRole('button', { name: 'Not now' }))

      expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument()
      expect(screen.getByText('Sign in again to resume syncing.')).toBeInTheDocument()
      await act(async () => {})
    })

    it('shows a quiet splash while the session is being resolved', async () => {
      ;(getMe as jest.Mock).mockReturnValue(new Promise(() => undefined))
      render(<App />)

      expect(screen.getByRole('status')).toHaveTextContent('Opening Logbook…')
      await act(async () => {})
    })
  })

  describe('when the server has no login (local-only)', () => {
    beforeEach(() => {
      delete (globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__
      ;(getAuthConfig as jest.Mock).mockResolvedValue({ methods: [] })
      ;(getCachedIdentity as jest.Mock).mockResolvedValue(null)
      ;(getMe as jest.Mock).mockClear()
      ;(renderGoogleSignInButton as jest.Mock).mockClear()
    })

    afterEach(() => {
      globalThis.__LOGBOOK_MOCKED__ = true
    })

    it('opens the app with no gate, no profile lookup and no Google button', async () => {
      render(<App />)

      expect(await screen.findByRole('button', { name: /new entry/i })).toBeInTheDocument()
      expect(getMe).not.toHaveBeenCalled()
      expect(renderGoogleSignInButton).not.toHaveBeenCalled()
      expect(screen.queryByText('Record climbs and jumps, even with no signal.')).not.toBeInTheDocument()
      await act(async () => {})
    })

    it('says sync is off on the timeline, and local-only in Settings', async () => {
      const user = userEvent.setup()
      render(<App />)
      await screen.findByRole('button', { name: /new entry/i })

      expect(await screen.findByText('Saved locally · sync is off')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /settings/i }))
      expect(screen.getByText('Local only · sign-in is off on this server')).toBeInTheDocument()
      await act(async () => {})
    })

    it('never shows the sign-in banner, even if something reports a 401', async () => {
      render(<App />)
      await screen.findByRole('button', { name: /new entry/i })

      const listeners = (subscribeToDrains as jest.Mock).mock.calls.map((call) => call[0])
      act(() => listeners.forEach((listener) => listener({ processed: 0, stoppedReason: 'auth' })))

      expect(screen.queryByText('Sign in again to resume syncing.')).not.toBeInTheDocument()
      await act(async () => {})
    })
  })

  describe('when the server cannot be asked and nothing is cached', () => {
    beforeEach(() => {
      delete (globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__
      ;(getAuthConfig as jest.Mock).mockResolvedValue(null)
      ;(getCachedIdentity as jest.Mock).mockResolvedValue(null)
      ;(getMe as jest.Mock).mockClear()
    })

    afterEach(() => {
      globalThis.__LOGBOOK_MOCKED__ = true
    })

    it('opens the app local-only instead of trapping an offline user at a gate', async () => {
      render(<App />)

      expect(await screen.findByRole('button', { name: /new entry/i })).toBeInTheDocument()
      expect(getMe).not.toHaveBeenCalled()
      await act(async () => {})
    })

    it('brings the gate up when the server later says it wants Google', async () => {
      render(<App />)
      await screen.findByRole('button', { name: /new entry/i })
      ;(getAuthConfig as jest.Mock).mockResolvedValue({ methods: [{ type: 'google', clientId: 'cid' }] })
      ;(getMe as jest.Mock).mockRejectedValue(new SyncAuthError(401, null))

      await act(async () => {
        window.dispatchEvent(new Event('online'))
      })

      expect(await screen.findByText('Record climbs and jumps, even with no signal.')).toBeInTheDocument()
      await act(async () => {})
    })
  })
})
