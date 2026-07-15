import { act, render, screen } from '@testing-library/react'
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

  it('walks the new-entry voice capture flow through to save', async () => {
    jest.useFakeTimers()
    const user = userEvent.setup({ delay: null, advanceTimers: jest.advanceTimersByTime })
    render(<App />)

    await user.click(screen.getByRole('button', { name: /new entry/i }))
    expect(screen.getByText('New entry')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(screen.getByText('Listening…')).toBeInTheDocument()

    await act(async () => {
      jest.advanceTimersByTime(1400)
    })
    expect(screen.getByText(/extracting details/i)).toBeInTheDocument()

    await act(async () => {
      jest.advanceTimersByTime(1400)
    })
    expect(screen.getByText('Extracted details')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    expect(screen.getByText('Saved locally · not synced')).toBeInTheDocument()

    jest.useRealTimers()
  })
})
