import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TimelineScreen } from './TimelineScreen.tsx'
import { entries } from '../data/entries.ts'

describe('TimelineScreen', () => {
  it('renders every entry as a card in list view', () => {
    render(
      <TimelineScreen
        entries={entries}
        timelineView="list"
        onChangeView={() => {}}
        onOpenEntry={() => {}}
      />,
    )
    for (const entry of entries) {
      expect(screen.getByText(entry.title)).toBeInTheDocument()
    }
  })

  it('opens an entry when its card is clicked', async () => {
    const onOpenEntry = jest.fn()
    const user = userEvent.setup()
    render(
      <TimelineScreen
        entries={entries}
        timelineView="list"
        onChangeView={() => {}}
        onOpenEntry={onOpenEntry}
      />,
    )
    await user.click(screen.getByText(entries[0].title))
    expect(onOpenEntry).toHaveBeenCalledWith(entries[0].id)
  })

  it('switches to map view and renders a pin + strip card per entry', () => {
    render(
      <TimelineScreen
        entries={entries}
        timelineView="map"
        onChangeView={() => {}}
        onOpenEntry={() => {}}
      />,
    )
    expect(screen.getAllByRole('button', { name: entries[0].title })).toHaveLength(1)
    expect(screen.getByText(entries[0].location)).toBeInTheDocument()
  })

  it('calls onChangeView when switching tabs', async () => {
    const onChangeView = jest.fn()
    const user = userEvent.setup()
    render(
      <TimelineScreen
        entries={entries}
        timelineView="list"
        onChangeView={onChangeView}
        onOpenEntry={() => {}}
      />,
    )
    await user.click(screen.getByRole('tab', { name: 'Map' }))
    expect(onChangeView).toHaveBeenCalledWith('map')
  })
})
