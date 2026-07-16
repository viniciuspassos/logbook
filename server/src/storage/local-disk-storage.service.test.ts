import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { LocalDiskStorageService } from './local-disk-storage.service'
import { StorageFileNotFoundError } from './storage.interface'

describe('LocalDiskStorageService', () => {
  let uploadDir: string
  let storage: LocalDiskStorageService

  beforeEach(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logbook-storage-test-'))
    storage = new LocalDiskStorageService({ uploadDir })
  })

  afterEach(async () => {
    await fs.rm(uploadDir, { recursive: true, force: true })
  })

  it('creates the upload directory lazily on first save if missing', async () => {
    const nestedDir = path.join(uploadDir, 'nested', 'dir')
    const nestedStorage = new LocalDiskStorageService({ uploadDir: nestedDir })

    await nestedStorage.save({
      buffer: Buffer.from('hello'),
      originalFilename: 'note.txt',
      mimeType: 'text/plain',
    })

    await expect(fs.stat(nestedDir)).resolves.toBeDefined()
  })

  it('saves a file and returns a key with the correct byte size', async () => {
    const buffer = Buffer.from('summit photo bytes')

    const result = await storage.save({
      buffer,
      originalFilename: 'summit.jpg',
      mimeType: 'image/jpeg',
    })

    expect(result.sizeBytes).toBe(buffer.byteLength)
    expect(result.key).toEqual(expect.stringContaining('summit'))
  })

  it('generates distinct keys for two saves of the same filename', async () => {
    const input = {
      buffer: Buffer.from('a'),
      originalFilename: 'dup.jpg',
      mimeType: 'image/jpeg',
    }

    const first = await storage.save(input)
    const second = await storage.save(input)

    expect(first.key).not.toBe(second.key)
  })

  it('round-trips: read() returns exactly what was saved', async () => {
    const buffer = Buffer.from('round trip contents')
    const { key } = await storage.save({
      buffer,
      originalFilename: 'trip.bin',
      mimeType: 'application/octet-stream',
    })

    const readBack = await storage.read(key)

    expect(readBack.equals(buffer)).toBe(true)
  })

  it('rejects reading an unknown key with StorageFileNotFoundError', async () => {
    await expect(storage.read('does-not-exist.bin')).rejects.toBeInstanceOf(
      StorageFileNotFoundError,
    )
  })

  it('deletes a saved file so a subsequent read fails', async () => {
    const { key } = await storage.save({
      buffer: Buffer.from('to be deleted'),
      originalFilename: 'gone.bin',
      mimeType: 'application/octet-stream',
    })

    await storage.delete(key)

    await expect(storage.read(key)).rejects.toBeInstanceOf(StorageFileNotFoundError)
  })

  it('treats deleting an already-missing key as a no-op (idempotent)', async () => {
    await expect(storage.delete('never-existed.bin')).resolves.toBeUndefined()
  })

  it('rejects a filename containing path separators to prevent path traversal', async () => {
    await expect(
      storage.save({
        buffer: Buffer.from('x'),
        originalFilename: '../../etc/passwd',
        mimeType: 'text/plain',
      }),
    ).rejects.toThrow(/invalid/i)
  })
})
