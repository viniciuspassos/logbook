import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { EntryDetailOverlay } from './EntryDetailOverlay.tsx'
import { entries } from '../data/entries.ts'

const entry = entries[1]

function renderOverlay(props: Partial<ComponentProps<typeof EntryDetailOverlay>> = {}) {
  return render(
    <EntryDetailOverlay
      entry={entry}
      rawOpen={false}
      onToggleRaw={() => {}}
      onClose={() => {}}
      onExportMarkdown={() => {}}
      onExportPdf={() => {}}
      {...props}
    />,
  )
}

describe('EntryDetailOverlay', () => {
  it('renders the entry story and metadata fields', () => {
    renderOverlay()
    expect(screen.getByText(entry.title)).toBeInTheDocument()
    expect(screen.getByText(entry.story)).toBeInTheDocument()
    expect(screen.getByText(entry.weather)).toBeInTheDocument()
    expect(screen.getByText(entry.duration)).toBeInTheDocument()
    expect(screen.getByText(entry.difficulty)).toBeInTheDocument()
    expect(screen.getByText(entry.participants)).toBeInTheDocument()
    expect(screen.getByText(entry.equipment)).toBeInTheDocument()
  })

  it('hides raw notes by default and shows them after toggling', () => {
    renderOverlay()
    expect(screen.queryByText(entry.raw, { exact: false })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show raw notes' })).toBeInTheDocument()
  })

  it('shows raw notes when rawOpen is true', () => {
    renderOverlay({ rawOpen: true })
    expect(screen.getByText(entry.raw, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide raw notes' })).toBeInTheDocument()
  })

  it('calls onToggleRaw when the toggle is clicked', async () => {
    const onToggleRaw = jest.fn()
    const user = userEvent.setup()
    renderOverlay({ onToggleRaw })
    await user.click(screen.getByRole('button', { name: 'Show raw notes' }))
    expect(onToggleRaw).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the back button is clicked', async () => {
    const onClose = jest.fn()
    const user = userEvent.setup()
    renderOverlay({ onClose })
    await user.click(screen.getByText('‹'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('exports this entry as markdown', async () => {
    const onExportMarkdown = jest.fn()
    const user = userEvent.setup()
    renderOverlay({ onExportMarkdown })
    await user.click(screen.getByRole('button', { name: 'Export Markdown' }))
    expect(onExportMarkdown).toHaveBeenCalledWith(entry)
  })

  it('exports this entry as PDF', async () => {
    const onExportPdf = jest.fn()
    const user = userEvent.setup()
    renderOverlay({ onExportPdf })
    await user.click(screen.getByRole('button', { name: 'Export PDF' }))
    expect(onExportPdf).toHaveBeenCalledWith(entry)
  })

  it('disables both exports while one is already in flight', () => {
    renderOverlay({ exportBusy: true })
    expect(screen.getByRole('button', { name: 'Export Markdown' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled()
  })
})
