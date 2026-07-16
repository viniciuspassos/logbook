// Ambient declarations for the File System Access API, used by the backup
// export/import flow. It's Chromium-only and absent from the DOM lib typings
// for this TS version, so we declare the minimal surface Logbook consumes.
// Runtime code always guards with `isFileSystemAccessSupported()` before use
// and falls back to a plain download / file input when it's missing.

interface FilePickerAcceptType {
  description?: string
  /** MIME type → list of matching extensions, e.g. `{ 'application/json': ['.json'] }`. */
  accept: Record<string, string[]>
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
  multiple?: boolean
}

interface FileSystemWritableFileStream {
  write(data: string | Blob): Promise<void>
  close(): Promise<void>
}

interface FileSystemFileHandleLike {
  getFile(): Promise<File>
  createWritable(): Promise<FileSystemWritableFileStream>
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>
  showOpenFilePicker?: (
    options?: OpenFilePickerOptions,
  ) => Promise<FileSystemFileHandleLike[]>
}
