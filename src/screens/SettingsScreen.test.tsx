import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsScreen } from './SettingsScreen.tsx'
import { getAiCapabilities } from '../lib/ai/availability.ts'
import type { ExportActions } from '../hooks/useExportActions.ts'
import type { UseAuthResult } from '../hooks/useAuth.ts'

jest.mock('../lib/ai/availability.ts', () => {
  const actual = jest.requireActual('../lib/ai/availability.ts')
  return { ...actual, getAiCapabilities: jest.fn() }
})

const getAiCapabilitiesMock = getAiCapabilities as jest.Mock

beforeEach(() => {
  getAiCapabilitiesMock.mockResolvedValue({
    speech: true,
    prompt: 'available',
    rewriter: 'available',
  })
})

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

function makeAuth(overrides: Partial<UseAuthResult> = {}): UseAuthResult {
  return {
    state: 'unknown',
    pending: false,
    error: null,
    login: jest.fn().mockResolvedValue(true),
    logout: jest.fn(),
    noteAuthRequired: jest.fn(),
    noteAuthConfirmed: jest.fn(),
    clearError: jest.fn(),
    ...overrides,
  }
}

/** Renders and flushes the AI-capability check's microtask before returning,
 * so every caller sees its settled effect without an act() warning. */
async function renderScreen(
  { entryCount = 5, auth: authOverrides, ...overrides }: Partial<ExportActions> & {
    entryCount?: number
    auth?: Partial<UseAuthResult>
  } = {},
) {
  const exports = makeExports(overrides)
  const auth = makeAuth(authOverrides)
  render(<SettingsScreen entryCount={entryCount} exports={exports} auth={auth} />)
  await act(async () => {})
  return { exports, auth }
}

describe('SettingsScreen', () => {
  it('renders the Data section', async () => {
    await renderScreen()
    expect(screen.getByText('Local storage')).toBeInTheDocument()
    expect(screen.getByText('Backup to file')).toBeInTheDocument()
    expect(screen.getByText('Restore from backup')).toBeInTheDocument()
    expect(screen.getByText('Export as Markdown')).toBeInTheDocument()
    expect(screen.getByText('Export as PDF')).toBeInTheDocument()
  })

  it('reports the real entry count rather than a hardcoded one', async () => {
    await renderScreen({ entryCount: 3 })
    expect(screen.getByText('3 entries')).toBeInTheDocument()
  })

  it('uses the singular noun for a single entry', async () => {
    await renderScreen({ entryCount: 1 })
    expect(screen.getByText('1 entry')).toBeInTheDocument()
  })

  it.each([
    ['Backup to file', 'backupToFile'],
    ['Restore from backup', 'restoreFromFile'],
    ['Export as Markdown', 'exportLogbookMarkdown'],
    ['Export as PDF', 'exportLogbookPdf'],
  ] as const)('runs %s', async (label, action) => {
    const user = userEvent.setup()
    const { exports } = await renderScreen()
    await user.click(screen.getByRole('button', { name: new RegExp(label) }))
    expect(exports[action]).toHaveBeenCalledTimes(1)
  })

  it('warns that restoring replaces existing entries', async () => {
    await renderScreen()
    expect(screen.getByText('replaces all entries')).toBeInTheDocument()
  })

  it('disables the data actions while an export is in flight', async () => {
    await renderScreen({ busy: true })
    for (const label of [
      'Backup to file',
      'Restore from backup',
      'Export as Markdown',
      'Export as PDF',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeDisabled()
    }
  })

  it('announces a success status politely', async () => {
    await renderScreen({ status: { tone: 'info', message: 'Backup saved.' } })
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Backup saved.')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })

  it('announces an error status', async () => {
    await renderScreen({ status: { tone: 'error', message: "That file isn't valid JSON." } })
    expect(screen.getByRole('status')).toHaveTextContent("That file isn't valid JSON.")
  })

  it('renders the Voice & AI section', async () => {
    await renderScreen()
    expect(screen.getByText('On-device processing')).toBeInTheDocument()
    expect(screen.getByText('Language')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
  })

  it('shows a neutral status while checking on-device AI capability', () => {
    // Deliberately unawaited: assert the pre-resolution render, before the
    // capability check's microtask has had a chance to settle.
    getAiCapabilitiesMock.mockReturnValue(new Promise(() => {}))
    render(<SettingsScreen entryCount={5} exports={makeExports()} auth={makeAuth()} />)
    expect(screen.getByText('Checking…')).toBeInTheDocument()
  })

  it('shows Enabled once the prompt and rewriter models are both ready', async () => {
    await renderScreen()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
  })

  it('shows a downloading state rather than Enabled when a model still needs fetching', async () => {
    getAiCapabilitiesMock.mockResolvedValue({
      speech: true,
      prompt: 'downloadable',
      rewriter: 'available',
    })
    await renderScreen()
    expect(screen.getByText('Downloading…')).toBeInTheDocument()
    expect(screen.queryByText('Enabled')).not.toBeInTheDocument()
  })

  it('does not claim on-device AI is enabled when it is unavailable', async () => {
    getAiCapabilitiesMock.mockResolvedValue({
      speech: false,
      prompt: 'unavailable',
      rewriter: 'unavailable',
    })
    await renderScreen()
    expect(screen.getByText('Not available in this browser')).toBeInTheDocument()
    expect(screen.queryByText('Enabled')).not.toBeInTheDocument()
  })

  it('degrades to unavailable rather than throwing when getAiCapabilities rejects', async () => {
    getAiCapabilitiesMock.mockRejectedValue(new Error('boom'))
    await renderScreen()
    expect(screen.getByText('Not available in this browser')).toBeInTheDocument()
    expect(screen.queryByText('Enabled')).not.toBeInTheDocument()
  })

  it('renders the About section', async () => {
    await renderScreen()
    expect(screen.getByText('Version')).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
  })

  it('renders an Account section offering a sign-in form when not signed in', async () => {
    await renderScreen({ auth: { state: 'unknown' } })
    expect(screen.getByText('Account')).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('renders the Account section as signed-in with a sign-out control', async () => {
    await renderScreen({ auth: { state: 'signedIn' } })
    expect(screen.getByText(/signed in/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('wires a password submission through to auth.login', async () => {
    const user = userEvent.setup()
    const login = jest.fn().mockResolvedValue(true)
    const { auth } = await renderScreen({ auth: { state: 'unknown', login } })

    await user.type(screen.getByLabelText(/password/i), 'hunter2')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(auth.login).toHaveBeenCalledWith('hunter2')
  })

  it('wires the sign-out button through to auth.logout', async () => {
    const user = userEvent.setup()
    const { auth } = await renderScreen({ auth: { state: 'signedIn' } })

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    expect(auth.logout).toHaveBeenCalledTimes(1)
  })
})
