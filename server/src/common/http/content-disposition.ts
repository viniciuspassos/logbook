export type ContentDispositionType = 'inline' | 'attachment'

/**
 * Builds a safe `Content-Disposition` header value for `filename`, which may
 * be attacker-controlled (e.g. an uploaded attachment's client-supplied
 * original filename, see #19). A raw `filename="..."` value built by naive
 * string interpolation is vulnerable to:
 *
 *  - header injection / response splitting if `filename` contains a `"`,
 *    CR, or LF — those can terminate the quoted-string early and let the
 *    rest of the value be interpreted as new header parameters/headers.
 *  - producing an invalid header for filenames with non-ASCII characters,
 *    which the legacy `filename=` quoted-string form doesn't support.
 *
 * This always emits both:
 *  - an ASCII-only `filename="..."` fallback (control characters stripped,
 *    quotes/backslashes escaped, non-ASCII replaced with `_`) for older
 *    clients, and
 *  - an RFC 5987/6266 `filename*=UTF-8''...` extended value carrying the
 *    full, percent-encoded original name, which modern browsers prefer.
 */
export function buildContentDisposition(
  type: ContentDispositionType,
  filename: string,
): string {
  const asciiFallback = toAsciiFallbackFilename(filename)
  const extended = encodeRfc5987(filename)
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${extended}`
}

function toAsciiFallbackFilename(filename: string): string {
  const withoutControlChars = filename.replace(/[\x00-\x1f\x7f]/g, '')
  const asciiOnly = withoutControlChars.replace(/[^\x20-\x7e]/g, '_')
  return asciiOnly.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * `encodeURIComponent` leaves `! * ' ( )` unescaped, but RFC 5987's
 * `attr-char` grammar excludes `* ' ( )` from the set of characters allowed
 * unescaped in an extended parameter value — they must be percent-encoded.
 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}
