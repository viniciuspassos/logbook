import { MAX_ATTACHMENT_BYTES, validateAttachmentFile } from './attachmentValidation.ts'

function fakeFile(overrides: { type?: string; size?: number } = {}): File {
  const size = overrides.size ?? 1024
  return {
    name: 'photo.jpg',
    type: overrides.type ?? 'image/jpeg',
    size,
  } as File
}

describe('validateAttachmentFile', () => {
  it('accepts an allowlisted image type under the size limit', () => {
    expect(validateAttachmentFile(fakeFile({ type: 'image/png', size: 1024 }))).toEqual({ ok: true })
  })

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])(
    'accepts %s',
    (type) => {
      expect(validateAttachmentFile(fakeFile({ type })).ok).toBe(true)
    },
  )

  it('rejects a non-image type', () => {
    const result = validateAttachmentFile(fakeFile({ type: 'text/plain' }))
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('supported') })
  })

  it('rejects an empty declared type (client MIME sniffing is best-effort only)', () => {
    const result = validateAttachmentFile(fakeFile({ type: '' }))
    expect(result.ok).toBe(false)
  })

  it('rejects a file over the size limit', () => {
    const result = validateAttachmentFile(fakeFile({ size: MAX_ATTACHMENT_BYTES + 1 }))
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('large') })
  })

  it('accepts a file exactly at the size limit', () => {
    expect(validateAttachmentFile(fakeFile({ size: MAX_ATTACHMENT_BYTES })).ok).toBe(true)
  })
})
