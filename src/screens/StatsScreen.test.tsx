import { render, screen } from '@testing-library/react'
import { StatsScreen } from './StatsScreen.tsx'
import { entries } from '../data/entries.ts'

/** Read a tile's value by its label, since values (e.g. 0) can repeat. */
function tileValue(label: string): string {
  const labelEl = screen.getByText(label)
  const value = labelEl.parentElement?.querySelector('.stats-screen__tile-value')
  return value?.textContent ?? ''
}

describe('StatsScreen', () => {
  it('computes the summary tiles from the entries', () => {
    render(<StatsScreen entries={entries} />)
    expect(tileValue('Adventures')).toBe('5')
    // Distinct location tails: Switzerland, Brazil, Chile, USA, Nepal.
    expect(tileValue('Countries')).toBe('5')
    // Largest metres figure across all metrics.
    expect(tileValue('Highest point')).toBe('4,000m')
  })

  it('renders a by-activity breakdown from the entries', () => {
    render(<StatsScreen entries={entries} />)
    expect(screen.getByText('Climbing')).toBeInTheDocument()
    expect(screen.getByText('Trekking')).toBeInTheDocument()
    expect(screen.getByText('Skydiving')).toBeInTheDocument()
  })

  it('shows an empty state when there are no entries', () => {
    render(<StatsScreen entries={[]} />)
    expect(screen.getByText('No adventures logged yet.')).toBeInTheDocument()
    expect(tileValue('Adventures')).toBe('0')
    expect(tileValue('Highest point')).toBe('—')
  })
})
