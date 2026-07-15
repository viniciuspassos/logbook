import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewEntryOverlay } from './NewEntryOverlay.tsx'

describe('NewEntryOverlay', () => {
  it('renders the capture step with a record button', () => {
    render(
      <NewEntryOverlay
        step="capture"
        onClose={() => {}}
        onStartRecording={() => {}}
        onSave={() => {}}
      />,
    )
    expect(screen.getByText('New entry')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument()
  })

  it('calls onStartRecording when the record button is pressed', async () => {
    const onStartRecording = jest.fn()
    const user = userEvent.setup()
    render(
      <NewEntryOverlay
        step="capture"
        onClose={() => {}}
        onStartRecording={onStartRecording}
        onSave={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(onStartRecording).toHaveBeenCalledTimes(1)
  })

  it('renders the listening step', () => {
    render(
      <NewEntryOverlay
        step="listening"
        onClose={() => {}}
        onStartRecording={() => {}}
        onSave={() => {}}
      />,
    )
    expect(screen.getByText('Listening…')).toBeInTheDocument()
  })

  it('renders the processing step', () => {
    render(
      <NewEntryOverlay
        step="processing"
        onClose={() => {}}
        onStartRecording={() => {}}
        onSave={() => {}}
      />,
    )
    expect(screen.getByText(/extracting details/i)).toBeInTheDocument()
  })

  it('renders the review step with extracted tags and a save action', async () => {
    const onSave = jest.fn()
    const user = userEvent.setup()
    render(
      <NewEntryOverlay
        step="review"
        onClose={() => {}}
        onStartRecording={() => {}}
        onSave={onSave}
      />,
    )
    expect(screen.getByText('Pico da Bandeira')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('calls onClose from the header back button', async () => {
    const onClose = jest.fn()
    const user = userEvent.setup()
    render(
      <NewEntryOverlay
        step="capture"
        onClose={onClose}
        onStartRecording={() => {}}
        onSave={() => {}}
      />,
    )
    await user.click(screen.getByText('‹'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
