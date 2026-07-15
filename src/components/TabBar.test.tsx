import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabBar } from './TabBar.tsx'

describe('TabBar', () => {
  it('marks the active tab as current', () => {
    render(<TabBar active="stats" onSelect={() => {}} onNewEntry={() => {}} />)
    expect(screen.getByRole('button', { name: /stats/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('button', { name: /timeline/i })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('calls onSelect with the clicked tab', async () => {
    const onSelect = jest.fn()
    const user = userEvent.setup()
    render(<TabBar active="timeline" onSelect={onSelect} onNewEntry={() => {}} />)
    await user.click(screen.getByRole('button', { name: /search/i }))
    expect(onSelect).toHaveBeenCalledWith('search')
  })

  it('calls onNewEntry when the center button is pressed', async () => {
    const onNewEntry = jest.fn()
    const user = userEvent.setup()
    render(<TabBar active="timeline" onSelect={() => {}} onNewEntry={onNewEntry} />)
    await user.click(screen.getByRole('button', { name: /new entry/i }))
    expect(onNewEntry).toHaveBeenCalledTimes(1)
  })
})
