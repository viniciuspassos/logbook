import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchScreen } from './SearchScreen.tsx'
import { entries } from '../data/entries.ts'

describe('SearchScreen', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('applies AI-parsed (fallback keyword, since AI is unavailable in jsdom) results once the debounce window elapses', async () => {
    jest.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    render(<SearchScreen entries={entries} onOpenEntry={() => {}} />)

    await user.type(screen.getByRole('searchbox'), 'nepal')

    // Debounced AI parse: jsdom has no Chrome AI globals, so parseSearchQuery
    // degrades to a plain keyword split (never blocking, per the Browser AI
    // rules) — this exercises that debounced `.then` re-render.
    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('Annapurna Base Camp')).toBeInTheDocument()
    expect(screen.queryByText('Solo tandem jump')).not.toBeInTheDocument()
  })

  it('lists every entry with no query typed', () => {
    render(<SearchScreen entries={entries} onOpenEntry={() => {}} />)
    for (const entry of entries) {
      expect(screen.getByText(entry.title)).toBeInTheDocument()
    }
    expect(screen.getByText('All entries')).toBeInTheDocument()
  })

  it('filters the list as the user types', async () => {
    const user = userEvent.setup()
    render(<SearchScreen entries={entries} onOpenEntry={() => {}} />)
    await user.type(screen.getByRole('searchbox'), 'nepal')
    expect(screen.getByText('Annapurna Base Camp')).toBeInTheDocument()
    expect(screen.queryByText('Solo tandem jump')).not.toBeInTheDocument()
    expect(screen.getByText('1 result')).toBeInTheDocument()
  })

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup()
    render(<SearchScreen entries={entries} onOpenEntry={() => {}} />)
    await user.type(screen.getByRole('searchbox'), 'antarctica')
    expect(screen.getByText(/no entries match/i)).toBeInTheDocument()
  })

  it('toggles a quick-filter tag into the search box', async () => {
    const user = userEvent.setup()
    render(<SearchScreen entries={entries} onOpenEntry={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'windy' }))
    expect(screen.getByRole('searchbox')).toHaveValue('windy')
    await user.click(screen.getByRole('button', { name: 'windy' }))
    expect(screen.getByRole('searchbox')).toHaveValue('')
  })

  it('opens an entry when its card is clicked', async () => {
    const onOpenEntry = jest.fn()
    const user = userEvent.setup()
    render(<SearchScreen entries={entries} onOpenEntry={onOpenEntry} />)
    await user.click(screen.getByText(entries[0].title))
    expect(onOpenEntry).toHaveBeenCalledWith(entries[0].id)
  })
})
