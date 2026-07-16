import { buildContentDisposition } from './content-disposition'

describe('buildContentDisposition', () => {
  it('builds an inline disposition with the filename quoted for plain ASCII names', () => {
    const header = buildContentDisposition('inline', 'summit.jpg')

    expect(header).toBe(`inline; filename="summit.jpg"; filename*=UTF-8''summit.jpg`)
  })

  it('builds an attachment disposition', () => {
    const header = buildContentDisposition('attachment', 'summit.jpg')

    expect(header).toMatch(/^attachment;/)
  })

  it('escapes double quotes in the ASCII fallback filename', () => {
    const header = buildContentDisposition('inline', 'evil".jpg')

    // The quoted-string fallback must not contain an unescaped `"` — that
    // would terminate the parameter early and let the rest of the value be
    // interpreted as new header parameters (header injection).
    expect(header).toContain('filename="evil\\".jpg"')
  })

  it('never lets a raw CR/LF reach the header value, even embedded in an attempted header-injection payload', () => {
    // The `filename*=` extended value percent-encodes CR/LF (and the colon
    // that would otherwise start a new header line), so "Set-Cookie" as
    // literal text is harmless there — it can only ever be decoded back
    // into a filename string, never reparsed as a header. What actually
    // matters is that no *raw* CR or LF byte appears anywhere in the
    // resulting header value.
    const header = buildContentDisposition(
      'inline',
      'evil.jpg"\r\nSet-Cookie: pwned=1',
    )

    expect(header).not.toMatch(/[\r\n]/)
    expect(header).toContain('filename="evil.jpg\\"Set-Cookie: pwned=1"')
  })

  it('percent-encodes the filename* extended value per RFC 5987, including reserved chars encodeURIComponent leaves alone', () => {
    const header = buildContentDisposition('inline', "it's a (test)*.jpg")

    expect(header).toContain(
      `filename*=UTF-8''it%27s%20a%20%28test%29%2A.jpg`,
    )
  })

  it('replaces non-ASCII characters in the fallback filename but preserves them in the extended value', () => {
    const header = buildContentDisposition('inline', 'sumário.jpg')

    expect(header).toContain('filename="sum_rio.jpg"')
    expect(header).toContain(`filename*=UTF-8''sum%C3%A1rio.jpg`)
  })
})
