import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EntryDetailOverlay } from './EntryDetailOverlay.tsx'
import { entries } from '../data/entries.ts'

const entry = entries[1]

describe('EntryDetailOverlay', () => {
  it('renders the entry story and metadata fields', () => {
    render(
      <EntryDetailOverlay
        entry={entry}
        rawOpen={false}
        onToggleRaw={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(entry.title)).toBeInTheDocument()
    expect(screen.getByText(entry.story)).toBeInTheDocument()
    expect(screen.getByText(entry.weather)).toBeInTheDocument()
    expect(screen.getByText(entry.duration)).toBeInTheDocument()
    expect(screen.getByText(entry.difficulty)).toBeInTheDocument()
    expect(screen.getByText(entry.participants)).toBeInTheDocument()
    expect(screen.getByText(entry.equipment)).toBeInTheDocument()
  })

  it('hides raw notes by default and shows them after toggling', () => {
    render(
      <EntryDetailOverlay
        entry={entry}
        rawOpen={false}
        onToggleRaw={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByText(entry.raw, { exact: false })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show raw notes' })).toBeInTheDocument()
  })

  it('shows raw notes when rawOpen is true', () => {
    render(
      <EntryDetailOverlay
        entry={entry}
        rawOpen={true}
        onToggleRaw={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(entry.raw, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide raw notes' })).toBeInTheDocument()
  })

  it('calls onToggleRaw when the toggle is clicked', async () => {
    const onToggleRaw = jest.fn()
    const user = userEvent.setup()
    render(
      <EntryDetailOverlay
        entry={entry}
        rawOpen={false}
        onToggleRaw={onToggleRaw}
        onClose={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Show raw notes' }))
    expect(onToggleRaw).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the back button is clicked', async () => {
    const onClose = jest.fn()
    const user = userEvent.setup()
    render(
      <EntryDetailOverlay
        entry={entry}
        rawOpen={false}
        onToggleRaw={() => {}}
        onClose={onClose}
      />,
    )
    await user.click(screen.getByText('‹'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
