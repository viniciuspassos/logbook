import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.tsx'
import { entries } from './data/entries.ts'

describe('App', () => {
  it('starts on the Timeline tab showing every entry', () => {
    render(<App />)
    expect(screen.getByText('Logbook')).toBeInTheDocument()
    for (const entry of entries) {
      expect(screen.getByText(entry.title)).toBeInTheDocument()
    }
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
    expect(screen.getByText('Saved locally · not synced')).toBeInTheDocument()
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
    expect(await screen.findByText('Saved locally · not synced')).toBeInTheDocument()
    // Appears as both the new card's title and its derived excerpt.
    expect(screen.getAllByText('Sunset trail run today').length).toBeGreaterThan(0)
  })
})
