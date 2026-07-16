import type { Entry } from '../../types/entry.ts'
import { detailFields, entryStory, hasValue, subtitleParts } from './entryFields.ts'
import { entryCountLabel, formatExportDate } from './exportHeader.ts'

/**
 * PDF export via the browser's own print-to-PDF, rather than a heavy PDF
 * library (the project prefers native APIs). We build a standalone printable
 * HTML document and hand it to a hidden iframe's `print()`, so printing never
 * disturbs the live app's DOM and needs no app-wide print stylesheet.
 *
 * The HTML builders are pure and unit-tested; `printHtml` is the thin IO shell.
 */

/** Escape text for safe interpolation into the generated HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Render prose as paragraphs, treating blank lines as breaks. */
function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
    .join('\n')
}

/** Render one entry as a printable HTML fragment (no document wrapper). */
export function entryToPrintHtml(entry: Entry): string {
  const blocks: string[] = [`<h1>${escapeHtml(entry.title.trim())}</h1>`]

  const subtitle = subtitleParts(entry)
    .map((part) => (part.emphasis ? `<strong>${escapeHtml(part.text)}</strong>` : escapeHtml(part.text)))
    .join(' · ')
  if (subtitle) blocks.push(`<p class="subtitle">${subtitle}</p>`)
  if (hasValue(entry.metric)) blocks.push(`<p class="metric">${escapeHtml(entry.metric.trim())}</p>`)

  const story = entryStory(entry)
  if (story) blocks.push(`<div class="story">${paragraphs(story)}</div>`)

  const details = detailFields(entry)
  if (details.length > 0) {
    const rows = details
      .map(
        (field) =>
          `<div class="field"><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value)}</dd></div>`,
      )
      .join('\n')
    blocks.push(`<h2>Details</h2>\n<dl class="details">\n${rows}\n</dl>`)
  }

  if (hasValue(entry.raw)) {
    blocks.push(`<h2>Raw notes</h2>\n<blockquote>${paragraphs(entry.raw.trim())}</blockquote>`)
  }

  return `<article class="entry">\n${blocks.join('\n')}\n</article>`
}

/** Print styling: deliberately plain, so the PDF reads like a journal page. */
const PRINT_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px;
    font-family: Georgia, 'Times New Roman', serif;
    color: #1a1a1a;
    line-height: 1.6;
  }
  h1 { font-size: 22pt; margin: 0 0 4px; }
  h2 {
    font-size: 11pt;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #666;
    margin: 24px 0 8px;
  }
  .subtitle { margin: 0 0 2px; color: #444; }
  .metric { margin: 0 0 16px; color: #666; font-variant-numeric: tabular-nums; }
  .story p { margin: 0 0 12px; }
  .details { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin: 0; }
  .field { break-inside: avoid; }
  dt { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; color: #888; }
  dd { margin: 0; }
  blockquote {
    margin: 0;
    padding-left: 14px;
    border-left: 2px solid #ddd;
    color: #555;
    font-style: italic;
  }
  .doc-header { border-bottom: 1px solid #ddd; padding-bottom: 12px; margin-bottom: 24px; }
  .doc-header h1 { font-size: 26pt; }
  .doc-header .subtitle { color: #666; }
  /* Each entry starts its own page in a multi-entry export. */
  .entry + .entry { break-before: page; padding-top: 8px; }
  @page { margin: 18mm; }
`

/** Wrap printable fragments in a standalone HTML document. */
export function buildPrintDocument(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`
}

/** A printable document for a single entry. */
export function entryToPrintDocument(entry: Entry): string {
  return buildPrintDocument(entry.title.trim(), entryToPrintHtml(entry))
}

/** A printable document for the whole logbook, one entry per page. */
export function logbookToPrintDocument(entries: Entry[], opts: { date: Date }): string {
  const header = `<header class="doc-header">
<h1>Logbook</h1>
<p class="subtitle">${entryCountLabel(entries.length)} · exported ${escapeHtml(formatExportDate(opts.date))}</p>
</header>`
  const body = entries.map(entryToPrintHtml).join('\n')
  return buildPrintDocument('Logbook', `${header}\n${body}`)
}

/**
 * Print `html` through a hidden iframe, resolving once the print dialog has
 * been dismissed. The iframe is always removed, even if printing throws, so a
 * failed print can't leak a detached document into the page.
 */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe')
    // Off-screen rather than `display: none`: some engines skip rendering —
    // and therefore printing — a fully hidden frame.
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.srcdoc = html

    iframe.onload = () => {
      try {
        const frameWindow = iframe.contentWindow
        if (!frameWindow) throw new Error('Could not open a print view.')
        frameWindow.focus()
        frameWindow.print()
        resolve()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      } finally {
        iframe.remove()
      }
    }

    // Without this the promise could never settle if the frame fails to load,
    // latching the caller's `busy` guard on for the life of the page.
    iframe.onerror = () => {
      iframe.remove()
      reject(new Error('Could not open a print view.'))
    }

    document.body.appendChild(iframe)
  })
}

/** Open the browser's print dialog for one entry (save as PDF from there). */
export function printEntry(entry: Entry): Promise<void> {
  return printHtml(entryToPrintDocument(entry))
}

/** Open the browser's print dialog for the whole logbook. */
export function printLogbook(entries: Entry[], opts: { date: Date }): Promise<void> {
  return printHtml(logbookToPrintDocument(entries, opts))
}
