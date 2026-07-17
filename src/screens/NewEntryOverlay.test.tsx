import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewEntryOverlay } from './NewEntryOverlay.tsx'
import { DEFAULT_MEDIA_HINTS, type Draft } from '../lib/buildEntry.ts'
import type { ExtractedEntryFields } from '../lib/ai/extractEntry.ts'
import type { NewEntryStep } from '../hooks/useNewEntryFlow.ts'

const extracted: ExtractedEntryFields = {
  title: 'Pico da Bandeira',
  activityType: 'Climbing',
  shape: 'triangle',
  location: 'Brazil',
  weather: 'Windy',
  duration: '6h',
  difficulty: 'Moderate',
  equipment: 'Helmet',
  participants: 'Group of 3',
  metric: '2,892m',
}

const emptyDraft: Draft = { raw: '', extracted: null, story: '' }

function renderOverlay(overrides: {
  step?: NewEntryStep
  draft?: Draft
  captureError?: string | null
  isRegenerating?: boolean
  transcript?: string
  interimTranscript?: string
  onClose?: () => void
  onStartRecording?: () => void
  onStopRecording?: () => void
  onSubmitTyped?: (text: string) => void
  onRegenerate?: () => void
  onEditStory?: (text: string) => void
  onSave?: () => void
} = {}) {
  const props = {
    step: 'capture' as NewEntryStep,
    draft: emptyDraft,
    captureError: null,
    isRegenerating: false,
    transcript: '',
    interimTranscript: '',
    onClose: jest.fn(),
    onStartRecording: jest.fn(),
    onStopRecording: jest.fn(),
    onSubmitTyped: jest.fn(),
    onRegenerate: jest.fn(),
    onEditStory: jest.fn(),
    onSave: jest.fn(),
    ...overrides,
  }
  render(<NewEntryOverlay {...props} />)
  return props
}

describe('NewEntryOverlay', () => {
  it('renders the capture step with a record button', () => {
    renderOverlay()
    expect(screen.getByText('New entry')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument()
  })

  it('calls onStartRecording when the record button is pressed', async () => {
    const user = userEvent.setup()
    const props = renderOverlay()
    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(props.onStartRecording).toHaveBeenCalledTimes(1)
  })

  it('shows a capture error as an alert', () => {
    renderOverlay({ captureError: 'Microphone access was blocked.' })
    expect(screen.getByRole('alert')).toHaveTextContent(/microphone access/i)
  })

  it('toggles to a text box and submits typed notes', async () => {
    const user = userEvent.setup()
    const props = renderOverlay()

    await user.click(screen.getByRole('button', { name: 'Type instead' }))
    const box = screen.getByRole('textbox', { name: 'Adventure notes' })
    const extractBtn = screen.getByRole('button', { name: 'Extract details' })
    expect(extractBtn).toBeDisabled()

    await user.type(box, 'quick evening hike')
    expect(extractBtn).toBeEnabled()
    await user.click(extractBtn)
    expect(props.onSubmitTyped).toHaveBeenCalledWith('quick evening hike')
  })

  it('switches back to voice mode from the text box', async () => {
    const user = userEvent.setup()
    renderOverlay()

    await user.click(screen.getByRole('button', { name: 'Type instead' }))
    expect(screen.getByRole('textbox', { name: 'Adventure notes' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Use voice instead' }))
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Adventure notes' })).not.toBeInTheDocument()
  })

  it('renders the listening step with the live transcript', () => {
    renderOverlay({ step: 'listening', transcript: 'climbed', interimTranscript: ' up' })
    expect(screen.getByText(/listening/i)).toBeInTheDocument()
    expect(screen.getByText(/climbed/)).toBeInTheDocument()
  })

  it('stops recording when the listening button is tapped', async () => {
    const user = userEvent.setup()
    const props = renderOverlay({ step: 'listening' })
    await user.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(props.onStopRecording).toHaveBeenCalledTimes(1)
  })

  it('renders the processing step', () => {
    renderOverlay({ step: 'processing' })
    expect(screen.getByText(/extracting details/i)).toBeInTheDocument()
  })

  it('renders the review step with extracted tags and a save action', async () => {
    const user = userEvent.setup()
    const props = renderOverlay({
      step: 'review',
      draft: { raw: 'climbed pico', extracted, story: 'A polished ascent.' },
    })
    expect(screen.getByText('Climbing')).toBeInTheDocument()
    expect(screen.getByText('Brazil')).toBeInTheDocument()
    expect(screen.getByText('A polished ascent.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(props.onRegenerate).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Save entry' }))
    expect(props.onSave).toHaveBeenCalledTimes(1)
  })

  it('previews the same media hints buildEntryFromDraft writes onto the saved entry', () => {
    renderOverlay({
      step: 'review',
      draft: { raw: 'climbed pico', extracted, story: 'A polished ascent.' },
    })
    for (const hint of DEFAULT_MEDIA_HINTS) {
      expect(screen.getByRole('img', { name: hint })).toBeInTheDocument()
    }
  })

  it('disables Regenerate while regenerating', () => {
    renderOverlay({
      step: 'review',
      isRegenerating: true,
      draft: { raw: 'x', extracted, story: 's' },
    })
    expect(screen.getByRole('button', { name: 'Regenerating…' })).toBeDisabled()
  })

  it('shows an editable story and a manual chip on the AI-unavailable path', async () => {
    const user = userEvent.setup()
    const props = renderOverlay({
      step: 'review',
      draft: { raw: 'raw note', extracted: null, story: 'raw note' },
    })
    expect(screen.getByText('Manual entry')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()

    const story = screen.getByRole('textbox', { name: 'Story' })
    await user.type(story, '!')
    expect(props.onEditStory).toHaveBeenCalled()
  })

  it('calls onClose from the header back button', async () => {
    const user = userEvent.setup()
    const props = renderOverlay()
    await user.click(screen.getByText('‹'))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })
})
