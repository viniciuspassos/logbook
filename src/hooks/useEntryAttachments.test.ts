import { act, renderHook, waitFor } from '@testing-library/react'
import { useEntryAttachments } from './useEntryAttachments.ts'
import { getEntryAttachmentSources, queueAttachmentUpload } from '../lib/sync/outboxQueue.ts'
import { drainOutbox } from '../lib/sync/outboxRunner.ts'
import { validateAttachmentFile } from '../lib/sync/attachmentValidation.ts'
import { attachmentFileUrl } from '../lib/sync/attachmentsApi.ts'
import type { Entry } from '../types/entry.ts'
import type { OutboxRecord } from '../types/outbox.ts'
import type { ServerAttachment } from '../types/sync.ts'

jest.mock('../lib/sync/outboxQueue.ts', () => ({
  getEntryAttachmentSources: jest.fn(),
  queueAttachmentUpload: jest.fn(),
}))
jest.mock('../lib/sync/outboxRunner.ts', () => ({
  drainOutbox: jest.fn(),
}))
jest.mock('../lib/sync/attachmentValidation.ts', () => ({
  validateAttachmentFile: jest.fn(),
}))
jest.mock('../lib/sync/attachmentsApi.ts', () => ({
  attachmentFileUrl: jest.fn((id: number) => `/api/attachments/${id}/file`),
}))

const sourcesMock = getEntryAttachmentSources as jest.Mock
const queueUploadMock = queueAttachmentUpload as jest.Mock
const drainMock = drainOutbox as jest.Mock
const validateMock = validateAttachmentFile as jest.Mock
const fileUrlMock = attachmentFileUrl as jest.Mock

function makeEntry(id: number): Entry {
  return {
    id,
    title: 'Summit day',
    shape: 'triangle',
    location: 'Alps',
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
  }
}

const attachment: ServerAttachment = {
  id: 10,
  entryId: 42,
  originalFilename: 'summit.jpg',
  storageKey: 'key',
  mimeType: 'image/jpeg',
  sizeBytes: 10,
  createdAt: '2026-01-01T00:00:00.000Z',
}

function fakeFile(name = 'photo.jpg'): File {
  return { name, type: 'image/jpeg', size: 100 } as File
}

beforeEach(() => {
  jest.clearAllMocks()
  sourcesMock.mockResolvedValue({ serverAttachments: [], pending: [] })
  queueUploadMock.mockResolvedValue(undefined)
  drainMock.mockResolvedValue({ processed: 0, stoppedReason: 'unreachable' })
  validateMock.mockReturnValue({ ok: true })
  fileUrlMock.mockImplementation((id: number) => `/api/attachments/${id}/file`)
  if (typeof URL.createObjectURL !== 'function') {
    // jsdom has no createObjectURL — this hook guards for that case, but the
    // "guard when it does exist" path is exercised here.
    Object.defineProperty(URL, 'createObjectURL', { value: jest.fn(() => 'blob:local'), writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: jest.fn(), writable: true })
  }
})

describe('useEntryAttachments', () => {
  it('starts empty when there is no open entry', () => {
    const { result } = renderHook(() => useEntryAttachments(null))
    expect(result.current.attachments).toEqual([])
    expect(sourcesMock).not.toHaveBeenCalled()
  })

  it('loads server attachments for the open entry', async () => {
    sourcesMock.mockResolvedValue({ serverAttachments: [attachment], pending: [] })
    const { result } = renderHook(() => useEntryAttachments(makeEntry(1)))

    await waitFor(() => expect(result.current.attachments).toHaveLength(1))
    expect(result.current.attachments[0]).toEqual({
      key: 'server-10',
      url: '/api/attachments/10/file',
      pending: false,
    })
  })

  it('renders a preview for a still-queued (pending) attachment', async () => {
    const pendingRecord: OutboxRecord = {
      queueId: 5,
      createdAt: '2026-01-01T00:00:00.000Z',
      attempts: 0,
      operation: {
        kind: 'upload-attachment',
        localEntryId: 1,
        file: new Blob(['bytes'], { type: 'image/jpeg' }),
        filename: 'summit.jpg',
      },
    }
    sourcesMock.mockResolvedValue({ serverAttachments: [], pending: [pendingRecord] })
    const { result } = renderHook(() => useEntryAttachments(makeEntry(1)))

    await waitFor(() => expect(result.current.attachments).toHaveLength(1))
    expect(result.current.attachments[0]).toMatchObject({ key: 'pending-5', pending: true })
  })

  it('reloads when the open entry changes', async () => {
    const { rerender } = renderHook(({ entry }) => useEntryAttachments(entry), {
      initialProps: { entry: makeEntry(1) as Entry | null },
    })
    await waitFor(() => expect(sourcesMock).toHaveBeenCalledTimes(1))

    rerender({ entry: makeEntry(2) })
    await waitFor(() => expect(sourcesMock).toHaveBeenCalledTimes(2))
    expect(sourcesMock).toHaveBeenLastCalledWith(makeEntry(2), expect.anything())
  })

  it('rejects an invalid file without queuing anything', async () => {
    validateMock.mockReturnValue({ ok: false, reason: 'Too big' })
    const { result } = renderHook(() => useEntryAttachments(makeEntry(1)))
    await waitFor(() => expect(sourcesMock).toHaveBeenCalled())

    act(() => result.current.addPhoto(fakeFile()))

    await waitFor(() => expect(result.current.status).toEqual({ tone: 'error', message: 'Too big' }))
    expect(queueUploadMock).not.toHaveBeenCalled()
  })

  it('queues a valid photo and announces it via status', async () => {
    const { result } = renderHook(() => useEntryAttachments(makeEntry(1)))
    await waitFor(() => expect(sourcesMock).toHaveBeenCalled())

    act(() => result.current.addPhoto(fakeFile('summit.jpg')))

    await waitFor(() =>
      expect(queueUploadMock).toHaveBeenCalledWith(makeEntry(1), expect.anything(), 'summit.jpg'),
    )
    await waitFor(() => expect(drainMock).toHaveBeenCalled())
    await waitFor(() => expect(result.current.status?.tone).toBe('info'))
    expect(result.current.busy).toBe(false)
  })

  it('shows an error status when queuing itself fails', async () => {
    queueUploadMock.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useEntryAttachments(makeEntry(1)))
    await waitFor(() => expect(sourcesMock).toHaveBeenCalled())

    act(() => result.current.addPhoto(fakeFile()))

    await waitFor(() => expect(result.current.status?.tone).toBe('error'))
    expect(result.current.busy).toBe(false)
  })

  it('resets status and busy when the open entry changes', async () => {
    queueUploadMock.mockRejectedValue(new Error('boom'))
    const { result, rerender } = renderHook(({ entry }) => useEntryAttachments(entry), {
      initialProps: { entry: makeEntry(1) as Entry | null },
    })
    await waitFor(() => expect(sourcesMock).toHaveBeenCalledTimes(1))

    act(() => result.current.addPhoto(fakeFile()))
    await waitFor(() => expect(result.current.status?.tone).toBe('error'))

    rerender({ entry: makeEntry(2) })
    expect(result.current.status).toBeNull()
    expect(result.current.busy).toBe(false)
    // Let entry 2's own (mocked, immediately-resolving) load settle before
    // the test ends, so its state update lands inside `act`.
    await waitFor(() => expect(sourcesMock).toHaveBeenCalledTimes(2))
  })

  it('does not let a slow upload for a previous entry clobber a newly-opened entry\'s state', async () => {
    let resolveDrain: ((value: { processed: number; stoppedReason: string }) => void) | undefined
    drainMock.mockReturnValue(
      new Promise((resolve) => {
        resolveDrain = resolve
      }),
    )
    const { result, rerender } = renderHook(({ entry }) => useEntryAttachments(entry), {
      initialProps: { entry: makeEntry(1) as Entry | null },
    })
    await waitFor(() => expect(sourcesMock).toHaveBeenCalledTimes(1))

    act(() => result.current.addPhoto(fakeFile()))
    await waitFor(() => expect(queueUploadMock).toHaveBeenCalled())

    // Switch to a different entry before entry 1's drain settles.
    sourcesMock.mockResolvedValue({ serverAttachments: [attachment], pending: [] })
    await act(async () => {
      rerender({ entry: makeEntry(2) })
    })
    await waitFor(() => expect(result.current.attachments).toHaveLength(1))

    // Entry 1's drain now resolves — it must not overwrite entry 2's status/gallery.
    await act(async () => {
      resolveDrain?.({ processed: 1, stoppedReason: 'empty' })
    })

    expect(result.current.status).toBeNull()
    expect(result.current.busy).toBe(false)
    expect(result.current.attachments).toHaveLength(1)
  })
})
