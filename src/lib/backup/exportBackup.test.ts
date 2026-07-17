import {
  BACKUP_VERSION,
  BackupError,
  backupFilename,
  createBackup,
  exportBackup,
  importBackup,
  isFileSystemAccessSupported,
  parseBackup,
  saveTextToFile,
  serializeBackup,
} from './exportBackup.ts'
import type { Entry } from '../../types/entry.ts'

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

describe('createBackup', () => {
  it('wraps entries with the current version and an ISO export timestamp', () => {
    const backup = createBackup([makeEntry({ id: 1 })], { date: new Date('2026-07-16T10:00:00Z') })
    expect(backup.version).toBe(BACKUP_VERSION)
    expect(backup.exportedAt).toBe('2026-07-16T10:00:00.000Z')
    expect(backup.entries).toHaveLength(1)
  })
})

describe('serializeBackup', () => {
  it('produces indented JSON that round-trips through parseBackup', () => {
    const entries = [makeEntry({ id: 1, title: 'Solo tandem jump' })]
    const json = serializeBackup(entries, { date: new Date('2026-07-16T10:00:00Z') })
    expect(json).toContain('\n  ')
    expect(parseBackup(json)).toEqual(entries)
  })
})

describe('backupFilename', () => {
  it('embeds the export date', () => {
    expect(backupFilename(new Date(2026, 6, 16))).toBe('logbook-backup-2026-07-16.json')
  })
})

describe('parseBackup', () => {
  function json(value: unknown): string {
    return JSON.stringify(value)
  }

  it('returns the entries from a valid backup', () => {
    const entries = [makeEntry({ id: 1 }), makeEntry({ id: 2 })]
    expect(parseBackup(json({ version: BACKUP_VERSION, entries }))).toEqual(entries)
  })

  it('throws a BackupError on malformed JSON', () => {
    expect(() => parseBackup('{not json')).toThrow(BackupError)
  })

  it('throws when the top level is not a backup object', () => {
    expect(() => parseBackup(json([]))).toThrow(BackupError)
    expect(() => parseBackup(json(null))).toThrow(BackupError)
  })

  it('throws when entries is missing or not an array', () => {
    expect(() => parseBackup(json({ version: BACKUP_VERSION }))).toThrow(BackupError)
    expect(() => parseBackup(json({ version: BACKUP_VERSION, entries: {} }))).toThrow(BackupError)
  })

  it('throws on a backup written by a newer version', () => {
    const entries = [makeEntry({ id: 1 })]
    expect(() => parseBackup(json({ version: BACKUP_VERSION + 1, entries }))).toThrow(
      /newer version/i,
    )
  })

  it('accepts an empty logbook', () => {
    expect(parseBackup(json({ version: BACKUP_VERSION, entries: [] }))).toEqual([])
  })

  it('throws when an entry lacks a usable id or title', () => {
    expect(() => parseBackup(json({ version: BACKUP_VERSION, entries: [{ title: 'x' }] }))).toThrow(
      BackupError,
    )
    expect(() => parseBackup(json({ version: BACKUP_VERSION, entries: [{ id: 1 }] }))).toThrow(
      BackupError,
    )
  })

  it('defaults missing optional fields so older backups still import', () => {
    const [entry] = parseBackup(
      json({ version: BACKUP_VERSION, entries: [{ id: 3, title: 'Old entry' }] }),
    )
    expect(entry.id).toBe(3)
    expect(entry.title).toBe('Old entry')
    expect(entry.shape).toBe('triangle')
    expect(entry.location).toBe('')
    expect(entry.media).toEqual(['', '', ''])
    expect(entry.mapX).toBe(50)
    expect(entry.mapY).toBe(50)
  })

  it('keeps a valid shape but falls back on an unknown one', () => {
    const entries = [
      { id: 1, title: 'a', shape: 'circle' },
      { id: 2, title: 'b', shape: 'hexagon' },
    ]
    const parsed = parseBackup(json({ version: BACKUP_VERSION, entries }))
    expect(parsed[0].shape).toBe('circle')
    expect(parsed[1].shape).toBe('triangle')
  })

  it('preserves activityType when present and leaves it undefined otherwise', () => {
    const entries = [
      { id: 1, title: 'a', activityType: 'Climbing' },
      { id: 2, title: 'b' },
    ]
    const parsed = parseBackup(json({ version: BACKUP_VERSION, entries }))
    expect(parsed[0].activityType).toBe('Climbing')
    expect(parsed[1].activityType).toBeUndefined()
  })

  it('coerces a non-triple media array to exactly three slots', () => {
    const entries = [{ id: 1, title: 'a', media: ['only one'] }]
    const [entry] = parseBackup(json({ version: BACKUP_VERSION, entries }))
    expect(entry.media).toEqual(['only one', '', ''])
  })
})

// --- IO shells ---------------------------------------------------------------

/** The picker globals are Chromium-only; jsdom has neither, so each test opts in. */
function clearPickers() {
  delete (window as Partial<Window>).showSaveFilePicker
  delete (window as Partial<Window>).showOpenFilePicker
}

function abortError(): DOMException {
  return new DOMException('The user aborted a request.', 'AbortError')
}

describe('isFileSystemAccessSupported', () => {
  afterEach(clearPickers)

  it('is false when the browser has no save picker', () => {
    clearPickers()
    expect(isFileSystemAccessSupported()).toBe(false)
  })

  it('is true once showSaveFilePicker exists', () => {
    window.showSaveFilePicker = jest.fn()
    expect(isFileSystemAccessSupported()).toBe(true)
  })
})

describe('saveTextToFile', () => {
  afterEach(() => {
    clearPickers()
    jest.restoreAllMocks()
  })

  it('writes through the save picker when available', async () => {
    const write = jest.fn().mockResolvedValue(undefined)
    const close = jest.fn().mockResolvedValue(undefined)
    window.showSaveFilePicker = jest
      .fn()
      .mockResolvedValue({ createWritable: jest.fn().mockResolvedValue({ write, close }) })

    const result = await saveTextToFile('hello', {
      filename: 'a.json',
      mimeType: 'application/json',
    })

    expect(result).toBe('saved')
    expect(window.showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'a.json' }),
    )
    expect(write).toHaveBeenCalledWith('hello')
    // The stream must be closed or the file is left truncated on disk.
    expect(close).toHaveBeenCalled()
  })

  it('reports cancellation when the user dismisses the picker', async () => {
    window.showSaveFilePicker = jest.fn().mockRejectedValue(abortError())
    await expect(
      saveTextToFile('hello', { filename: 'a.json', mimeType: 'application/json' }),
    ).resolves.toBe('cancelled')
  })

  it('propagates non-abort picker failures', async () => {
    window.showSaveFilePicker = jest.fn().mockRejectedValue(new Error('disk full'))
    await expect(
      saveTextToFile('hello', { filename: 'a.json', mimeType: 'application/json' }),
    ).rejects.toThrow('disk full')
  })

  it('falls back to a download when there is no save picker', async () => {
    clearPickers()
    const createObjectURL = jest.fn().mockReturnValue('blob:fake')
    const revokeObjectURL = jest.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await expect(
      saveTextToFile('hello', { filename: 'a.json', mimeType: 'application/json' }),
    ).resolves.toBe('saved')

    expect(click).toHaveBeenCalled()
    expect(document.querySelector('a[download]')).toBeNull()
    // Revoking on the same tick can cancel the download on the very engines
    // this fallback exists for, so it must be deferred — but must still happen.
    expect(revokeObjectURL).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })
})

describe('exportBackup', () => {
  afterEach(clearPickers)

  it('saves a serialized snapshot under a dated filename', async () => {
    const write = jest.fn().mockResolvedValue(undefined)
    window.showSaveFilePicker = jest.fn().mockResolvedValue({
      createWritable: jest.fn().mockResolvedValue({ write, close: jest.fn() }),
    })

    const entries = [makeEntry({ id: 1 })]
    await exportBackup(entries, { date: new Date(2026, 6, 16) })

    expect(window.showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'logbook-backup-2026-07-16.json' }),
    )
    expect(parseBackup(write.mock.calls[0][0] as string)).toEqual(entries)
  })
})

describe('importBackup', () => {
  afterEach(clearPickers)

  function fileWith(text: string): File {
    // jsdom's File.text() is unreliable across versions; stub it directly.
    return { text: () => Promise.resolve(text) } as unknown as File
  }

  it('returns the entries from the chosen file', async () => {
    const entries = [makeEntry({ id: 1, title: 'Imported' })]
    const json = serializeBackup(entries, { date: new Date(2026, 6, 16) })
    window.showOpenFilePicker = jest
      .fn()
      .mockResolvedValue([{ getFile: () => Promise.resolve(fileWith(json)) }])

    await expect(importBackup()).resolves.toEqual(entries)
  })

  it('returns null when the user cancels the picker', async () => {
    window.showOpenFilePicker = jest.fn().mockRejectedValue(abortError())
    await expect(importBackup()).resolves.toBeNull()
  })

  it('surfaces a BackupError for an unreadable file', async () => {
    window.showOpenFilePicker = jest
      .fn()
      .mockResolvedValue([{ getFile: () => Promise.resolve(fileWith('{not json')) }])
    await expect(importBackup()).rejects.toThrow(BackupError)
  })

  it('returns null when the file-input fallback is dismissed', async () => {
    clearPickers()
    jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      this.dispatchEvent(new Event('cancel'))
    })

    await expect(importBackup()).resolves.toBeNull()
    jest.restoreAllMocks()
  })

  it('returns the entries from a file chosen via the input-fallback `change` event', async () => {
    clearPickers()
    const entries = [makeEntry({ id: 1, title: 'Chosen via input' })]
    const json = serializeBackup(entries, { date: new Date(2026, 6, 16) })
    const file = fileWith(json)

    jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, 'files', { value: [file], configurable: true })
      this.dispatchEvent(new Event('change'))
    })

    await expect(importBackup()).resolves.toEqual(entries)
    expect(document.querySelector('input[type=file]')).toBeNull()
    jest.restoreAllMocks()
  })

  it('settles on window focus for engines that never fire `cancel`', async () => {
    clearPickers()
    // Simulate an older browser: opening the dialog fires no input event at
    // all. Without the focus backstop this promise would hang forever and
    // latch the caller's busy guard on permanently.
    jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})

    const pending = importBackup()
    window.dispatchEvent(new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve, 350))

    await expect(pending).resolves.toBeNull()
    // The transient input must not be left behind in the DOM.
    expect(document.querySelector('input[type=file]')).toBeNull()
    jest.restoreAllMocks()
  })
})
