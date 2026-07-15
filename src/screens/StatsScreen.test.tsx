import { render, screen } from '@testing-library/react'
import { StatsScreen } from './StatsScreen.tsx'

describe('StatsScreen', () => {
  it('renders the summary tiles', () => {
    render(<StatsScreen />)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Adventures')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(screen.getByText('Days out')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('Countries')).toBeInTheDocument()
    expect(screen.getByText('4,000m')).toBeInTheDocument()
    expect(screen.getByText('Highest point')).toBeInTheDocument()
  })

  it('renders the by-activity breakdown', () => {
    render(<StatsScreen />)
    expect(screen.getByText('Climbing')).toBeInTheDocument()
    expect(screen.getByText('Trekking')).toBeInTheDocument()
    expect(screen.getByText('Hiking')).toBeInTheDocument()
    expect(screen.getByText('Skydiving')).toBeInTheDocument()
  })
})
