import type { AdventureShape, Entry } from '../../types/entry.ts'

/**
 * JSON snapshot backup of the whole logbook.
 *
 * The pure parts (`createBackup`/`serializeBackup`/`parseBackup`) hold all the
 * format knowledge and are fully unit-tested; the file-picker wrappers at the
 * bottom are thin IO shells over the File System Access API, with a plain
 * download / `<input type="file">` fallback for browsers that lack it.
 */

/** Bumped whenever the on-disk backup shape changes incompatibly. */
export const BACKUP_VERSION = 1

const SHAPES: AdventureShape[] = ['circle', 'triangle', 'diamond']

export interface BackupFile {
  version: number
  /** ISO-8601 timestamp of when the snapshot was taken. */
  exportedAt: string
  entries: Entry[]
}

/** A backup file we can't read — always thrown with a user-presentable message. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

/** Wrap entries in the versioned envelope. Clock injected to stay testable. */
export function createBackup(entries: Entry[], opts: { date: Date }): BackupFile {
  return {
    version: BACKUP_VERSION,
    exportedAt: opts.date.toISOString(),
    entries,
  }
}

/** The exact bytes written to disk: indented so a backup stays human-readable. */
export function serializeBackup(entries: Entry[], opts: { date: Date }): string {
  return JSON.stringify(createBackup(entries, opts), null, 2)
}

/** A dated, filesystem-safe filename for a backup snapshot. */
export function backupFilename(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `logbook-backup-${date.getFullYear()}-${month}-${day}.json`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Exactly three media hints, padding or truncating whatever the file had. */
function mediaTriple(value: unknown): [string, string, string] {
  const list = Array.isArray(value) ? value : []
  return [str(list[0]), str(list[1]), str(list[2])]
}

/**
 * Normalize one raw parsed object into an `Entry`. Only `id` and `title` are
 * genuinely required — everything else defaults, so a backup taken by an older
 * build (or hand-edited) still imports instead of hard-failing.
 */
function normalizeEntry(value: unknown, index: number): Entry {
  if (!isRecord(value)) {
    throw new BackupError(`Entry ${index + 1} is not an object.`)
  }
  if (typeof value.id !== 'number' || !Number.isFinite(value.id)) {
    throw new BackupError(`Entry ${index + 1} is missing a numeric id.`)
  }
  if (typeof value.title !== 'string' || value.title.trim() === '') {
    throw new BackupError(`Entry ${index + 1} is missing a title.`)
  }

  const shape = SHAPES.includes(value.shape as AdventureShape)
    ? (value.shape as AdventureShape)
    : 'triangle'
  const activityType = typeof value.activityType === 'string' ? value.activityType : undefined

  return {
    id: value.id,
    title: value.title,
    shape,
    ...(activityType ? { activityType } : {}),
    location: str(value.location),
    date: str(value.date),
    metric: str(value.metric),
    excerpt: str(value.excerpt),
    weather: str(value.weather),
    duration: str(value.duration),
    difficulty: str(value.difficulty),
    equipment: str(value.equipment),
    participants: str(value.participants),
    raw: str(value.raw),
    story: str(value.story),
    photoHint: str(value.photoHint),
    media: mediaTriple(value.media),
    mapX: num(value.mapX, 50),
    mapY: num(value.mapY, 50),
  }
}

/** Read a backup file's JSON into entries, or throw a {@link BackupError}. */
export function parseBackup(json: string): Entry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new BackupError("That file isn't valid JSON.")
  }

  if (!isRecord(parsed)) {
    throw new BackupError("That file doesn't look like a Logbook backup.")
  }
  if (num(parsed.version, BACKUP_VERSION) > BACKUP_VERSION) {
    throw new BackupError(
      'That backup was written by a newer version of Logbook. Update the app and try again.',
    )
  }
  if (!Array.isArray(parsed.entries)) {
    throw new BackupError("That backup has no entries list.")
  }

  return parsed.entries.map(normalizeEntry)
}

// --- IO shells ---------------------------------------------------------------

/** Whether the browser can write files directly via a save dialog. */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
}

/** True when the user simply dismissed the picker — not an error worth surfacing. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

const JSON_TYPE: FilePickerAcceptType = {
  description: 'Logbook backup',
  accept: { 'application/json': ['.json'] },
}

/** Fallback save path: hand the blob to the browser's normal download flow. */
function downloadText(text: string, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoke on a later task, not this one. This path only runs on engines
  // without showSaveFilePicker (Firefox/Safari), where the download starts
  // asynchronously after click() — revoking synchronously can invalidate the
  // blob before the download reads it, silently producing no file.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export type SaveResult = 'saved' | 'cancelled'

/**
 * Write `text` to a user-chosen file. Uses the File System Access save dialog
 * when available, otherwise falls back to a download. Returns `'cancelled'`
 * when the user dismisses the dialog.
 */
export async function saveTextToFile(
  text: string,
  opts: { filename: string; mimeType: string; type?: FilePickerAcceptType },
): Promise<SaveResult> {
  if (!isFileSystemAccessSupported()) {
    downloadText(text, opts.filename, opts.mimeType)
    return 'saved'
  }
  try {
    const handle = await window.showSaveFilePicker!({
      suggestedName: opts.filename,
      types: opts.type ? [opts.type] : undefined,
    })
    const writable = await handle.createWritable()
    await writable.write(text)
    await writable.close()
    return 'saved'
  } catch (error) {
    if (isAbortError(error)) return 'cancelled'
    throw error
  }
}

/** Export the whole logbook as a JSON backup. Returns `'cancelled'` if dismissed. */
export async function exportBackup(
  entries: Entry[],
  opts: { date: Date },
): Promise<SaveResult> {
  return saveTextToFile(serializeBackup(entries, opts), {
    filename: backupFilename(opts.date),
    mimeType: 'application/json',
    type: JSON_TYPE,
  })
}

/** Fallback open path: a transient file input, resolving null if nothing is picked. */
function pickFileViaInput(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'

    let settled = false
    function settle(file: File | null) {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onWindowFocus)
      input.remove()
      resolve(file)
    }

    // Belt-and-braces cancellation. `cancel` is the correct signal but is only
    // in newer engines (Chrome 113+, Safari 16.4+); without a backstop, an
    // older browser dismissing the dialog would never settle this promise and
    // would leave the caller's `busy` guard latched on forever. Regaining
    // window focus with no file chosen means the dialog closed empty.
    function onWindowFocus() {
      // Defer: `change` fires after `focus` when a file *was* chosen, so give
      // it a turn to win the race before declaring the pick cancelled.
      setTimeout(() => settle(input.files?.[0] ?? null), 300)
    }

    input.addEventListener('cancel', () => settle(null))
    input.addEventListener('change', () => settle(input.files?.[0] ?? null))
    window.addEventListener('focus', onWindowFocus, { once: true })

    document.body.appendChild(input)
    input.click()
  })
}

/**
 * Let the user pick a backup file and return its entries, or `null` if they
 * cancelled. Throws {@link BackupError} when the chosen file isn't readable.
 */
export async function importBackup(): Promise<Entry[] | null> {
  let file: File | null

  if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [JSON_TYPE],
        multiple: false,
      })
      file = await handle.getFile()
    } catch (error) {
      if (isAbortError(error)) return null
      throw error
    }
  } else {
    file = await pickFileViaInput('application/json,.json')
  }

  if (!file) return null
  return parseBackup(await file.text())
}
