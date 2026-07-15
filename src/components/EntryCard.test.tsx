import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EntryCard } from './EntryCard.tsx'
import { entries } from '../data/entries.ts'

const entry = entries[0]

describe('EntryCard', () => {
  it('renders the entry summary', () => {
    render(<EntryCard entry={entry} onOpen={() => {}} />)
    expect(screen.getByText(entry.title)).toBeInTheDocument()
    expect(screen.getByText(entry.date)).toBeInTheDocument()
    expect(screen.getByText(`${entry.location} · ${entry.metric}`)).toBeInTheDocument()
    expect(screen.getByText(entry.excerpt)).toBeInTheDocument()
  })

  it('hides the excerpt when showExcerpt is false', () => {
    render(<EntryCard entry={entry} onOpen={() => {}} showExcerpt={false} />)
    expect(screen.queryByText(entry.excerpt)).not.toBeInTheDocument()
  })

  it('calls onOpen when clicked', async () => {
    const onOpen = jest.fn()
    const user = userEvent.setup()
    render(<EntryCard entry={entry} onOpen={onOpen} />)
    await user.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('calls onOpen on Enter and Space', async () => {
    const onOpen = jest.fn()
    const user = userEvent.setup()
    render(<EntryCard entry={entry} onOpen={onOpen} />)
    screen.getByRole('button').focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onOpen).toHaveBeenCalledTimes(2)
  })
})
