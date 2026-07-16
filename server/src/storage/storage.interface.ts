/** Input accepted by any FileStorage implementation's save(). */
export interface SaveFileInput {
  buffer: Buffer
  originalFilename: string
  mimeType: string
}

/** Result of a successful save — enough to retrieve the file again later. */
export interface StoredFile {
  /** Opaque identifier the storage backend can resolve back to the bytes (a path key today, an S3 object key later). */
  key: string
  sizeBytes: number
}

export class StorageFileNotFoundError extends Error {
  constructor(key: string) {
    super(`No stored file found for key "${key}"`)
    this.name = 'StorageFileNotFoundError'
  }
}

/**
 * Storage seam for uploaded attachment bytes. Local-disk today
 * (LocalDiskStorageService); the contract is deliberately narrow (buffer in,
 * opaque key out; key in, buffer out) so an S3-compatible implementation can
 * be swapped in later via storage.module.ts without changing
 * AttachmentsService or the upload endpoint's request/response contract.
 */
export interface FileStorage {
  save(input: SaveFileInput): Promise<StoredFile>
  read(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
}

/** DI token — inject with `@Inject(FILE_STORAGE)`. */
export const FILE_STORAGE = Symbol('FILE_STORAGE')
