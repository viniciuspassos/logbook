import { useCallback, useRef, useState } from 'react'
import {
  BackupError,
  exportBackup,
  importBackup,
  saveTextToFile,
} from '../lib/backup/exportBackup.ts'
import { printEntry, printLogbook } from '../lib/export/printDocument.ts'
import {
  entriesToMarkdown,
  entryToMarkdown,
  markdownFilename,
} from '../lib/export/toMarkdown.ts'
import type { Entry } from '../types/entry.ts'

/**
 * Wires the export/backup libraries to the UI. Every action funnels through
 * `run`, which serialises requests (a second click while a picker is open is
 * ignored) and turns the outcome into a short status message the screens can
 * show — so a cancelled picker reads as nothing happening, and a real failure
 * is surfaced rather than swallowed.
 */

export interface ExportStatus {
  tone: 'info' | 'error'
  message: string
}

const MARKDOWN_TYPE = {
  description: 'Markdown document',
  accept: { 'text/markdown': ['.md'] },
}

export interface ExportActions {
  status: ExportStatus | null
  busy: boolean
  clearStatus: () => void
  exportEntryMarkdown: (entry: Entry) => void
  exportEntryPdf: (entry: Entry) => void
  exportLogbookMarkdown: () => void
  exportLogbookPdf: () => void
  backupToFile: () => void
  restoreFromFile: () => void
}

/** Turn any thrown value into something worth showing a user. */
function messageFor(error: unknown): string {
  if (error instanceof BackupError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong.'
}

export function useExportActions(
  entries: Entry[],
  opts: {
    /** Injected clock, so export filenames/headers are deterministic in tests. */
    now?: () => Date
    onRestore: (entries: Entry[]) => Promise<void>
  },
): ExportActions {
  const [status, setStatus] = useState<ExportStatus | null>(null)
  const [busy, setBusy] = useState(false)
  // A ref, not `busy`: the guard must see the update synchronously, before
  // React re-renders, or a double-click opens two pickers.
  const running = useRef(false)
  const now = opts.now ?? (() => new Date())

  const run = useCallback(async (action: () => Promise<ExportStatus | null>) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setStatus(null)
    try {
      setStatus(await action())
    } catch (error) {
      setStatus({ tone: 'error', message: messageFor(error) })
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [])

  const clearStatus = useCallback(() => setStatus(null), [])

  function exportEntryMarkdown(entry: Entry) {
    void run(async () => {
      const result = await saveTextToFile(entryToMarkdown(entry), {
        filename: markdownFilename(entry),
        mimeType: 'text/markdown',
        type: MARKDOWN_TYPE,
      })
      return result === 'saved' ? { tone: 'info', message: 'Markdown exported.' } : null
    })
  }

  function exportLogbookMarkdown() {
    void run(async () => {
      const date = now()
      const result = await saveTextToFile(entriesToMarkdown(entries, { date }), {
        filename: 'logbook.md',
        mimeType: 'text/markdown',
        type: MARKDOWN_TYPE,
      })
      return result === 'saved' ? { tone: 'info', message: 'Markdown exported.' } : null
    })
  }

  function exportEntryPdf(entry: Entry) {
    void run(async () => {
      await printEntry(entry)
      return null
    })
  }

  function exportLogbookPdf() {
    void run(async () => {
      await printLogbook(entries, { date: now() })
      return null
    })
  }

  function backupToFile() {
    void run(async () => {
      const result = await exportBackup(entries, { date: now() })
      return result === 'saved'
        ? { tone: 'info', message: 'Backup saved.' }
        : null
    })
  }

  function restoreFromFile() {
    void run(async () => {
      const restored = await importBackup()
      if (!restored) return null
      await opts.onRestore(restored)
      const noun = restored.length === 1 ? 'entry' : 'entries'
      return { tone: 'info', message: `Restored ${restored.length} ${noun}.` }
    })
  }

  return {
    status,
    busy,
    clearStatus,
    exportEntryMarkdown,
    exportEntryPdf,
    exportLogbookMarkdown,
    exportLogbookPdf,
    backupToFile,
    restoreFromFile,
  }
}
