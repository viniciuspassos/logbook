import { act, renderHook, waitFor } from '@testing-library/react'
import { useExportActions } from './useExportActions.ts'
import { BackupError, exportBackup, importBackup, saveTextToFile } from '../lib/backup/exportBackup.ts'
import { printEntry, printLogbook } from '../lib/export/printDocument.ts'
import type { Entry } from '../types/entry.ts'

jest.mock('../lib/backup/exportBackup.ts', () => {
  const actual = jest.requireActual('../lib/backup/exportBackup.ts')
  return {
    ...actual,
    saveTextToFile: jest.fn(),
    exportBackup: jest.fn(),
    importBackup: jest.fn(),
  }
})
jest.mock('../lib/export/printDocument.ts', () => ({
  printEntry: jest.fn(),
  printLogbook: jest.fn(),
}))

const mockSaveTextToFile = saveTextToFile as jest.MockedFunction<typeof saveTextToFile>
const mockExportBackup = exportBackup as jest.MockedFunction<typeof exportBackup>
const mockImportBackup = importBackup as jest.MockedFunction<typeof importBackup>
const mockPrintEntry = printEntry as jest.MockedFunction<typeof printEntry>
const mockPrintLogbook = printLogbook as jest.MockedFunction<typeof printLogbook>

function makeEntry(overrides: Partial<Entry> & { id: number }): Entry {
  return {
    title: `Entry ${overrides.id}`,
    shape: 'triangle',
    location: 'Somewhere',
    date: 'Jul 3',
    metric: '',
    excerpt: '',
    weather: '',
    duration: '',
    difficulty: '',
    equipment: '',
    participants: '',
    raw: '',
    story: '',
    photoHint: '',
    media: ['a', 'b', 'c'],
    mapX: 50,
    mapY: 50,
    ...overrides,
  }
}

const NOW = new Date(2026, 6, 16)

function setup(entries: Entry[] = [makeEntry({ id: 1 })]) {
  const onRestore = jest.fn().mockResolvedValue(undefined)
  const view = renderHook(() => useExportActions(entries, { now: () => NOW, onRestore }))
  return { ...view, onRestore, entries }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSaveTextToFile.mockResolvedValue('saved')
  mockExportBackup.mockResolvedValue('saved')
  mockImportBackup.mockResolvedValue(null)
  mockPrintEntry.mockResolvedValue(undefined)
  mockPrintLogbook.mockResolvedValue(undefined)
})

describe('useExportActions', () => {
  it('starts idle', () => {
    const { result } = setup()
    expect(result.current.status).toBeNull()
    expect(result.current.busy).toBe(false)
  })

  it('exports a single entry as markdown under its own filename', async () => {
    const { result } = setup()
    const entry = makeEntry({ id: 7, title: 'Solo tandem jump' })

    await act(async () => result.current.exportEntryMarkdown(entry))

    expect(mockSaveTextToFile).toHaveBeenCalledWith(
      expect.stringContaining('# Solo tandem jump'),
      expect.objectContaining({ filename: 'solo-tandem-jump-7.md', mimeType: 'text/markdown' }),
    )
    expect(result.current.status).toEqual({ tone: 'info', message: 'Markdown exported.' })
  })

  it('exports the whole logbook as markdown', async () => {
    const { result } = setup([makeEntry({ id: 1 }), makeEntry({ id: 2 })])

    await act(async () => result.current.exportLogbookMarkdown())

    const [text, options] = mockSaveTextToFile.mock.calls[0]
    expect(text).toContain('2 entries · exported Jul 16, 2026')
    expect(options).toEqual(expect.objectContaining({ filename: 'logbook.md' }))
  })

  it('stays silent when the user cancels the save dialog', async () => {
    mockSaveTextToFile.mockResolvedValue('cancelled')
    const { result } = setup()

    await act(async () => result.current.exportLogbookMarkdown())

    expect(result.current.status).toBeNull()
  })

  it('backs up to a file and reports success', async () => {
    const { result, entries } = setup()

    await act(async () => result.current.backupToFile())

    expect(mockExportBackup).toHaveBeenCalledWith(entries, { date: NOW })
    expect(result.current.status).toEqual({ tone: 'info', message: 'Backup saved.' })
  })

  it('prints a single entry and the whole logbook', async () => {
    const { result, entries } = setup()
    const entry = makeEntry({ id: 3 })

    await act(async () => result.current.exportEntryPdf(entry))
    expect(mockPrintEntry).toHaveBeenCalledWith(entry)

    await act(async () => result.current.exportLogbookPdf())
    expect(mockPrintLogbook).toHaveBeenCalledWith(entries, { date: NOW })
  })

  it('restores entries from a backup and reports the count', async () => {
    const restored = [makeEntry({ id: 1 }), makeEntry({ id: 2 })]
    mockImportBackup.mockResolvedValue(restored)
    const { result, onRestore } = setup()

    await act(async () => result.current.restoreFromFile())

    expect(onRestore).toHaveBeenCalledWith(restored)
    expect(result.current.status).toEqual({ tone: 'info', message: 'Restored 2 entries.' })
  })

  it('uses the singular noun when restoring one entry', async () => {
    mockImportBackup.mockResolvedValue([makeEntry({ id: 1 })])
    const { result } = setup()

    await act(async () => result.current.restoreFromFile())

    expect(result.current.status?.message).toBe('Restored 1 entry.')
  })

  it('does not restore when the user cancels the open dialog', async () => {
    mockImportBackup.mockResolvedValue(null)
    const { result, onRestore } = setup()

    await act(async () => result.current.restoreFromFile())

    expect(onRestore).not.toHaveBeenCalled()
    expect(result.current.status).toBeNull()
  })

  it("surfaces a bad backup file's message as an error", async () => {
    mockImportBackup.mockRejectedValue(new BackupError("That file isn't valid JSON."))
    const { result } = setup()

    await act(async () => result.current.restoreFromFile())

    expect(result.current.status).toEqual({
      tone: 'error',
      message: "That file isn't valid JSON.",
    })
  })

  it('surfaces an unexpected failure without leaving the hook busy', async () => {
    mockExportBackup.mockRejectedValue(new Error('disk full'))
    const { result } = setup()

    await act(async () => result.current.backupToFile())

    expect(result.current.status).toEqual({ tone: 'error', message: 'disk full' })
    expect(result.current.busy).toBe(false)
  })

  it('falls back to a generic message for a non-Error throw', async () => {
    mockExportBackup.mockRejectedValue('boom')
    const { result } = setup()

    await act(async () => result.current.backupToFile())

    expect(result.current.status).toEqual({ tone: 'error', message: 'Something went wrong.' })
  })

  it('ignores a second action while one is still in flight', async () => {
    let release: (() => void) | undefined
    mockExportBackup.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve('saved') }),
    )
    const { result } = setup()

    act(() => result.current.backupToFile())
    await waitFor(() => expect(result.current.busy).toBe(true))

    // A double-click must not open a second picker.
    act(() => result.current.backupToFile())
    expect(mockExportBackup).toHaveBeenCalledTimes(1)

    await act(async () => {
      release?.()
    })
    expect(result.current.busy).toBe(false)
  })

  it('clears a status message on request', async () => {
    const { result } = setup()
    await act(async () => result.current.backupToFile())
    expect(result.current.status).not.toBeNull()

    act(() => result.current.clearStatus())
    expect(result.current.status).toBeNull()
  })
})
