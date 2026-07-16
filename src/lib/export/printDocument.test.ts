import {
  buildPrintDocument,
  entryToPrintDocument,
  entryToPrintHtml,
  escapeHtml,
  logbookToPrintDocument,
  printEntry,
  printHtml,
  printLogbook,
} from './printDocument.ts'
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

describe('escapeHtml', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<img src="x" onerror='alert(1)' /> & done`)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39; /&gt; &amp; done',
    )
  })

  it('leaves plain text untouched', () => {
    expect(escapeHtml('Interlaken, Switzerland')).toBe('Interlaken, Switzerland')
  })
})

describe('entryToPrintHtml', () => {
  it('renders title, subtitle, metric, story, details and raw notes', () => {
    const html = entryToPrintHtml(
      makeEntry({
        id: 1,
        title: 'Solo tandem jump',
        activityType: 'Skydiving',
        location: 'Interlaken',
        date: 'Jul 3',
        metric: '4,000m',
        story: 'The plane door opened.',
        weather: 'Clear',
        raw: 'rough note',
      }),
    )
    expect(html).toContain('<h1>Solo tandem jump</h1>')
    expect(html).toContain('<strong>Skydiving</strong> · Interlaken · Jul 3')
    expect(html).toContain('4,000m')
    expect(html).toContain('<p>The plane door opened.</p>')
    expect(html).toContain('<dt>Weather</dt><dd>Clear</dd>')
    expect(html).toContain('<blockquote><p>rough note</p></blockquote>')
  })

  it('escapes user content rather than emitting it as markup', () => {
    const html = entryToPrintHtml(
      makeEntry({ id: 1, title: '<script>alert(1)</script>', story: 'a & b' }),
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a &amp; b')
  })

  it('splits prose into paragraphs on blank lines and keeps single breaks', () => {
    const html = entryToPrintHtml(makeEntry({ id: 1, story: 'one\n\ntwo\nstill two' }))
    expect(html).toContain('<p>one</p>')
    expect(html).toContain('<p>two<br />still two</p>')
  })

  it('omits sections that have no content', () => {
    const html = entryToPrintHtml(makeEntry({ id: 1, location: '', date: '' }))
    expect(html).not.toContain('<h2>Details</h2>')
    expect(html).not.toContain('<h2>Raw notes</h2>')
    expect(html).not.toContain('class="metric"')
  })
})

describe('buildPrintDocument', () => {
  it('produces a standalone document with an escaped title and print styles', () => {
    const doc = buildPrintDocument('A & B', '<p>body</p>')
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc).toContain('<title>A &amp; B</title>')
    expect(doc).toContain('@page')
    expect(doc).toContain('<p>body</p>')
  })
})

describe('entryToPrintDocument', () => {
  it('titles the document after the entry', () => {
    const doc = entryToPrintDocument(makeEntry({ id: 1, title: 'Solo tandem jump' }))
    expect(doc).toContain('<title>Solo tandem jump</title>')
    expect(doc).toContain('<h1>Solo tandem jump</h1>')
  })
})

describe('logbookToPrintDocument', () => {
  it('renders a header with the entry count and export date', () => {
    const doc = logbookToPrintDocument([makeEntry({ id: 1 }), makeEntry({ id: 2 })], {
      date: new Date(2026, 6, 16),
    })
    expect(doc).toContain('2 entries · exported Jul 16, 2026')
  })

  it('includes every entry', () => {
    const doc = logbookToPrintDocument(
      [makeEntry({ id: 1, title: 'First' }), makeEntry({ id: 2, title: 'Second' })],
      { date: new Date(2026, 6, 16) },
    )
    expect(doc).toContain('<h1>First</h1>')
    expect(doc).toContain('<h1>Second</h1>')
  })

  it('renders an empty logbook as just a header', () => {
    const doc = logbookToPrintDocument([], { date: new Date(2026, 6, 16) })
    expect(doc).toContain('0 entries')
    expect(doc).not.toContain('<article')
  })
})

describe('printHtml', () => {
  /**
   * jsdom has no print(); stub it onto every iframe's contentWindow as it
   * loads, then report what got called.
   */
  function stubFramePrint(impl?: () => void): { print: jest.Mock } {
    const print = jest.fn(impl)
    jest
      .spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get')
      .mockReturnValue({ focus: jest.fn(), print } as unknown as Window)
    return { print }
  }

  /** jsdom doesn't load srcdoc frames on its own; fire onload manually. */
  function flushFrameLoad() {
    const iframe = document.querySelector('iframe')
    iframe?.dispatchEvent(new Event('load'))
    return iframe
  }

  afterEach(() => {
    jest.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('prints the html through an iframe and cleans it up', async () => {
    const { print } = stubFramePrint()
    const pending = printHtml('<p>hi</p>')

    const iframe = document.querySelector('iframe')
    expect(iframe?.srcdoc).toBe('<p>hi</p>')
    // The frame must not be announced to assistive tech.
    expect(iframe?.getAttribute('aria-hidden')).toBe('true')

    flushFrameLoad()
    await pending

    expect(print).toHaveBeenCalled()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('rejects and still removes the iframe when printing throws', async () => {
    stubFramePrint(() => {
      throw new Error('print blocked')
    })
    const pending = printHtml('<p>hi</p>')
    flushFrameLoad()

    await expect(pending).rejects.toThrow('print blocked')
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('rejects when the iframe exposes no window', async () => {
    jest
      .spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get')
      .mockReturnValue(null)
    const pending = printHtml('<p>hi</p>')
    flushFrameLoad()

    await expect(pending).rejects.toThrow(/print view/i)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('rejects instead of hanging when the frame fails to load', async () => {
    const pending = printHtml('<p>hi</p>')
    document.querySelector('iframe')?.dispatchEvent(new Event('error'))

    await expect(pending).rejects.toThrow(/print view/i)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('prints a single entry and the whole logbook', async () => {
    const print = jest.fn()
    jest
      .spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get')
      .mockReturnValue({ focus: jest.fn(), print } as unknown as Window)

    const entryPending = printEntry(makeEntry({ id: 1, title: 'Solo' }))
    expect(document.querySelector('iframe')?.srcdoc).toContain('<h1>Solo</h1>')
    flushFrameLoad()
    await entryPending

    const logbookPending = printLogbook([makeEntry({ id: 1 })], { date: new Date(2026, 6, 16) })
    expect(document.querySelector('iframe')?.srcdoc).toContain('1 entry · exported Jul 16, 2026')
    flushFrameLoad()
    await logbookPending

    expect(print).toHaveBeenCalledTimes(2)
  })
})
