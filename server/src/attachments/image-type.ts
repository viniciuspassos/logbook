/**
 * Allowlisted image MIME types for attachment uploads (#19). Deliberately
 * narrow: photo attachments only, nothing a browser could ever be tricked
 * into rendering as markup.
 *
 * `image/heif` is included alongside `image/heic` because both are the same
 * ISO-base-media-file container (ISOBMFF/HEIF); which MIME comes out depends
 * on which major brand the encoder wrote into the `ftyp` box (see
 * detectHeicFamily below) — iPhone photos typically use the `heic`/`heix`
 * brands (-> image/heic), while the generic single-image HEIF brand `mif1`
 * maps to image/heif. Both are "the same kind of file" from a safety
 * standpoint, so both are allowlisted.
 */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number]

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// Major brands written into an ISOBMFF `ftyp` box by HEIC/HEIF encoders.
// Mirrors the mapping used by the `file-type` package (a transitive
// dependency of @nestjs/common, see PR description for why we hand-roll
// this instead of taking it on directly) so behaviour matches what that
// ecosystem already treats as ground truth.
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx'])
const HEIF_BRANDS = new Set(['mif1', 'msf1'])

/**
 * Sniffs the *actual bytes* of `buffer` for a known image file signature
 * ("magic bytes") and returns the corresponding allowlisted MIME type, or
 * `null` if the bytes don't match any allowlisted image format.
 *
 * This is the single source of truth for "what type is this file" anywhere
 * attachment bytes are accepted or served. A client-declared Content-Type
 * (Multer's `file.mimetype`) or a filename extension is attacker-controlled
 * and must never be trusted in its place (#19).
 */
export function detectImageType(buffer: Buffer): AllowedImageMimeType | null {
  if (isJpeg(buffer)) {
    return 'image/jpeg'
  }
  if (isPng(buffer)) {
    return 'image/png'
  }
  if (isWebp(buffer)) {
    return 'image/webp'
  }
  return detectHeicFamily(buffer)
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
}

function isPng(buffer: Buffer): boolean {
  if (buffer.length < PNG_SIGNATURE.length) {
    return false
  }
  return PNG_SIGNATURE.every((byte, index) => buffer[index] === byte)
}

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
}

function detectHeicFamily(buffer: Buffer): 'image/heic' | 'image/heif' | null {
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') {
    return null
  }
  const brand = buffer.toString('ascii', 8, 12).replace(/\0/g, '').trim()
  if (HEIC_BRANDS.has(brand)) {
    return 'image/heic'
  }
  if (HEIF_BRANDS.has(brand)) {
    return 'image/heif'
  }
  return null
}
