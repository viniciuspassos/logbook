import type { Entry } from '../../types/entry.ts'
import { detailFields, entryStory, hasValue, subtitleParts } from './entryFields.ts'
import { entryCountLabel, formatExportDate } from './exportHeader.ts'

/**
 * Pure Markdown formatters for logbook entries. No DOM, no file I/O — the
 * caller decides what to do with the string (download it, print it, copy it),
 * which keeps the formatting fully unit-testable. Field-selection rules are
 * shared with the printable view via `entryFields.ts`.
 */

/** Lowercase, punctuation-free, hyphen-separated form of `text`, for filenames. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize('NFD')
    // Strip combining accents so "Pico" and "Pícó" slug identically.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'entry'
}

/** Render one entry as a standalone Markdown document. */
export function entryToMarkdown(entry: Entry): string {
  const blocks: string[] = [`# ${entry.title.trim()}`]

  const subtitle = subtitleParts(entry)
    .map((part) => (part.emphasis ? `**${part.text}**` : part.text))
    .join(' · ')
  if (subtitle) blocks.push(subtitle)
  if (hasValue(entry.metric)) blocks.push(entry.metric.trim())

  const story = entryStory(entry)
  if (story) blocks.push(story)

  const details = detailFields(entry)
  if (details.length > 0) {
    blocks.push('## Details')
    blocks.push(details.map((f) => `- **${f.label}:** ${f.value}`).join('\n'))
  }

  if (hasValue(entry.raw)) {
    const quoted = entry.raw
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    blocks.push('## Raw notes', quoted)
  }

  return `${blocks.join('\n\n')}\n`
}

/**
 * Render the whole logbook as one Markdown document — a header plus every
 * entry, separated by horizontal rules. The clock is injected so the output
 * stays deterministic in tests.
 */
export function entriesToMarkdown(entries: Entry[], opts: { date: Date }): string {
  const header = `# Logbook\n\n_${entryCountLabel(entries.length)} · exported ${formatExportDate(opts.date)}_\n`

  if (entries.length === 0) return header

  const body = entries.map(entryToMarkdown).join('\n---\n\n')
  return `${header}\n---\n\n${body}`
}

/** A stable, filesystem-safe filename for a single-entry Markdown export. */
export function markdownFilename(entry: Entry): string {
  return `${slugify(entry.title)}-${entry.id}.md`
}
