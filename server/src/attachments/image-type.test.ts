import { ALLOWED_IMAGE_MIME_TYPES, detectImageType } from './image-type'

function buffer(bytes: number[]): Buffer {
  return Buffer.from(bytes)
}

describe('detectImageType', () => {
  it('detects a JPEG from its SOI marker', () => {
    const jpeg = buffer([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

    expect(detectImageType(jpeg)).toBe('image/jpeg')
  })

  it('detects a PNG from its 8-byte signature', () => {
    const png = buffer([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])

    expect(detectImageType(png)).toBe('image/png')
  })

  it('detects a WEBP from its RIFF/WEBP container', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      buffer([0x00, 0x00, 0x00, 0x00]), // RIFF chunk size, irrelevant to detection
      Buffer.from('WEBP', 'ascii'),
    ])

    expect(detectImageType(webp)).toBe('image/webp')
  })

  it.each([
    ['heic', 'image/heic'],
    ['heix', 'image/heic'],
    ['hevc', 'image/heic'],
    ['hevx', 'image/heic'],
    ['mif1', 'image/heif'],
    ['msf1', 'image/heif'],
  ])('detects an ISOBMFF ftyp brand "%s" as %s', (brand, mime) => {
    const heic = Buffer.concat([
      buffer([0x00, 0x00, 0x00, 0x18]), // box size, irrelevant to detection
      Buffer.from('ftyp', 'ascii'),
      Buffer.from(brand, 'ascii'),
    ])

    expect(detectImageType(heic)).toBe(mime)
  })

  it('returns null for an ISOBMFF ftyp brand that is not an allowlisted HEIC/HEIF brand (e.g. mp4)', () => {
    const mp4 = Buffer.concat([
      buffer([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from('isom', 'ascii'),
    ])

    expect(detectImageType(mp4)).toBeNull()
  })

  it('returns null for an HTML payload declaring itself as an image (the #19 spoofed-upload case)', () => {
    const htmlPayload = Buffer.from(
      '<html><body><script>alert(document.cookie)</script></body></html>',
      'utf-8',
    )

    expect(detectImageType(htmlPayload)).toBeNull()
  })

  it('returns null for an empty buffer', () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull()
  })

  it('returns null for a buffer too short to contain any known signature', () => {
    expect(detectImageType(buffer([0xff, 0xd8]))).toBeNull()
  })

  it('does not misdetect a PNG-prefixed buffer that is truncated before the full signature', () => {
    expect(detectImageType(buffer([0x89, 0x50, 0x4e]))).toBeNull()
  })

  it('exposes the allowlist as the exact five image MIME types', () => {
    expect(ALLOWED_IMAGE_MIME_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ])
  })
})
