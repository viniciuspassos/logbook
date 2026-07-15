import { render, screen } from '@testing-library/react'
import { SettingsScreen } from './SettingsScreen.tsx'

describe('SettingsScreen', () => {
  it('renders the Data section', () => {
    render(<SettingsScreen />)
    expect(screen.getByText('Local storage')).toBeInTheDocument()
    expect(screen.getByText('5 entries')).toBeInTheDocument()
    expect(screen.getByText('Backup to file')).toBeInTheDocument()
    expect(screen.getByText('Export as Markdown')).toBeInTheDocument()
    expect(screen.getByText('Export as PDF')).toBeInTheDocument()
  })

  it('renders the Voice & AI section', () => {
    render(<SettingsScreen />)
    expect(screen.getByText('On-device processing')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('Language')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
  })

  it('renders the About section', () => {
    render(<SettingsScreen />)
    expect(screen.getByText('Version')).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
  })
})
