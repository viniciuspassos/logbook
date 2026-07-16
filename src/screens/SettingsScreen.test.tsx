import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsScreen } from './SettingsScreen.tsx'
import type { ExportActions } from '../hooks/useExportActions.ts'

function makeExports(overrides: Partial<ExportActions> = {}): ExportActions {
  return {
    status: null,
    busy: false,
    clearStatus: jest.fn(),
    exportEntryMarkdown: jest.fn(),
    exportEntryPdf: jest.fn(),
    exportLogbookMarkdown: jest.fn(),
    exportLogbookPdf: jest.fn(),
    backupToFile: jest.fn(),
    restoreFromFile: jest.fn(),
    ...overrides,
  }
}

function renderScreen(
  { entryCount = 5, ...overrides }: Partial<ExportActions> & { entryCount?: number } = {},
) {
  const exports = makeExports(overrides)
  render(<SettingsScreen entryCount={entryCount} exports={exports} />)
  return exports
}

describe('SettingsScreen', () => {
  it('renders the Data section', () => {
    renderScreen()
    expect(screen.getByText('Local storage')).toBeInTheDocument()
    expect(screen.getByText('Backup to file')).toBeInTheDocument()
    expect(screen.getByText('Restore from backup')).toBeInTheDocument()
    expect(screen.getByText('Export as Markdown')).toBeInTheDocument()
    expect(screen.getByText('Export as PDF')).toBeInTheDocument()
  })

  it('reports the real entry count rather than a hardcoded one', () => {
    renderScreen({ entryCount: 3 })
    expect(screen.getByText('3 entries')).toBeInTheDocument()
  })

  it('uses the singular noun for a single entry', () => {
    renderScreen({ entryCount: 1 })
    expect(screen.getByText('1 entry')).toBeInTheDocument()
  })

  it.each([
    ['Backup to file', 'backupToFile'],
    ['Restore from backup', 'restoreFromFile'],
    ['Export as Markdown', 'exportLogbookMarkdown'],
    ['Export as PDF', 'exportLogbookPdf'],
  ] as const)('runs %s', async (label, action) => {
    const user = userEvent.setup()
    const exports = renderScreen()
    await user.click(screen.getByRole('button', { name: new RegExp(label) }))
    expect(exports[action]).toHaveBeenCalledTimes(1)
  })

  it('warns that restoring replaces existing entries', () => {
    renderScreen()
    expect(screen.getByText('replaces all entries')).toBeInTheDocument()
  })

  it('disables the data actions while an export is in flight', () => {
    renderScreen({ busy: true })
    for (const label of [
      'Backup to file',
      'Restore from backup',
      'Export as Markdown',
      'Export as PDF',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeDisabled()
    }
  })

  it('announces a success status politely', () => {
    renderScreen({ status: { tone: 'info', message: 'Backup saved.' } })
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Backup saved.')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })

  it('announces an error status', () => {
    renderScreen({ status: { tone: 'error', message: "That file isn't valid JSON." } })
    expect(screen.getByRole('status')).toHaveTextContent("That file isn't valid JSON.")
  })

  it('renders the Voice & AI section', () => {
    renderScreen()
    expect(screen.getByText('On-device processing')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('Language')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
  })

  it('renders the About section', () => {
    renderScreen()
    expect(screen.getByText('Version')).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
  })
})
