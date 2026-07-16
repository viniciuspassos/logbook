import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  type FileStorage,
  StorageFileNotFoundError,
  type SaveFileInput,
  type StoredFile,
} from './storage.interface'

export interface LocalDiskStorageOptions {
  uploadDir: string
}

/**
 * Disk-backed FileStorage implementation. Keys are `<uuid>-<sanitized name>`
 * relative to `uploadDir`, so collisions across concurrent uploads of the
 * same filename can't happen and the key alone is safe to use as a path
 * segment. Constructed via a factory in storage.module.ts (reads `uploadDir`
 * from AppConfig) so this class itself stays a plain, easily-unit-tested
 * value object with no Nest DI coupling.
 */
export class LocalDiskStorageService implements FileStorage {
  private readonly uploadDir: string

  constructor(options: LocalDiskStorageOptions) {
    this.uploadDir = options.uploadDir
  }

  async save(input: SaveFileInput): Promise<StoredFile> {
    const safeName = sanitizeFilename(input.originalFilename)
    const key = `${randomUUID()}-${safeName}`

    await this.ensureUploadDir()
    await fs.writeFile(this.resolveKey(key), input.buffer)

    return { key, sizeBytes: input.buffer.byteLength }
  }

  async read(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolveKey(key))
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new StorageFileNotFoundError(key)
      }
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolveKey(key))
    } catch (error) {
      if (isNotFoundError(error)) {
        return
      }
      throw error
    }
  }

  private resolveKey(key: string): string {
    return path.join(this.uploadDir, key)
  }

  private async ensureUploadDir(): Promise<void> {
    await fs.mkdir(this.uploadDir, { recursive: true })
  }
}

function sanitizeFilename(originalFilename: string): string {
  const base = path.basename(originalFilename)
  if (base !== originalFilename || base === '' || base === '.' || base === '..') {
    throw new Error(`Invalid filename: "${originalFilename}"`)
  }
  return base
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  )
}
