import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.tsx'
import { entries } from './data/entries.ts'
import { subscribeToDrains } from './lib/sync/outboxRunner.ts'

// The real runner, with subscribeToDrains wrapped so a test can hand a drain
// outcome straight to whoever subscribed.
jest.mock('./lib/sync/outboxRunner.ts', () => {
  const actual = jest.requireActual('./lib/sync/outboxRunner.ts')
  return { ...actual, subscribeToDrains: jest.fn(actual.subscribeToDrains) }
})

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
    act(() => listener({ processed: 0, stoppedReason: 'auth' }))
    expect(screen.getByRole('status')).toHaveTextContent('Saved locally · sign in to sync')
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
})
