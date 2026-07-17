import { getApiBaseUrl } from './config.ts'
import { CSRF_HEADER_NAME, readCsrfToken } from './csrf.ts'
import { SyncAuthError, SyncConflictError, SyncHttpError, SyncNetworkError } from './errors.ts'
import type { ServerEntry } from '../../types/sync.ts'

/**
 * Low-level fetch wrapper shared by every `sync/*Api` module. Resolves paths
 * against the configured API base (config.ts), always sends cookies
 * (`credentials: 'include'`), attaches the CSRF header on mutating requests
 * (csrf.ts), and turns non-2xx responses into the typed errors in errors.ts
 * so callers can `instanceof`-narrow instead of re-parsing status codes.
 *
 * `fetch` itself is guarded with `typeof fetch === 'undefined'`, same as the
 * `typeof LanguageModel === 'undefined'` pattern in `src/lib/ai` — jsdom has
 * no global `fetch`, so tests opt in locally by assigning
 * `globalThis.fetch`, and a browser that somehow lacks it degrades to a
 * network error rather than throwing a raw ReferenceError.
 */

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

export interface RequestOptions {
  method?: string
  /** JSON-encoded unless it's a `FormData` (attachment uploads), which is
   *  sent as-is so the browser can set the multipart boundary itself. */
  body?: unknown
  signal?: AbortSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData
}

/** Body + headers for the outgoing request, JSON-encoding unless it's FormData. */
function buildBody(
  body: unknown,
  headers: Record<string, string>,
): BodyInit | undefined {
  if (body === undefined) return undefined
  if (isFormData(body)) return body
  headers['Content-Type'] = 'application/json'
  return JSON.stringify(body)
}

/** Parses a response body as JSON, falling back to raw text, `null` if empty. */
async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Best-effort human message for an error body of unknown shape. */
function extractMessage(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    const inner = isRecord(body.message) ? body.message : body
    if (typeof inner.message === 'string') return inner.message
  }
  return fallback
}

/**
 * The #24 conflict payload nests one level deeper behind the app's global
 * AllExceptionsFilter (`{ message: { message, currentEntry } }` — see
 * EntryVersionConflictException). Also accepts a flat `{ currentEntry }`
 * so this stays robust if that filter's wrapping ever changes.
 */
function extractCurrentEntry(body: unknown): ServerEntry | null {
  if (!isRecord(body)) return null
  const inner = isRecord(body.message) ? body.message : body
  if (isRecord(inner.currentEntry)) {
    return inner.currentEntry as unknown as ServerEntry
  }
  return null
}

async function performFetch(path: string, options: RequestOptions): Promise<Response> {
  if (typeof fetch === 'undefined') {
    throw new SyncNetworkError('This environment has no fetch available.')
  }

  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {}
  const body = buildBody(options.body, headers)

  if (MUTATING_METHODS.has(method)) {
    const csrfToken = readCsrfToken()
    if (csrfToken) headers[CSRF_HEADER_NAME] = csrfToken
  }

  try {
    return await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new SyncNetworkError()
  }
}

/** Builds and throws the right typed error for a non-2xx response. */
async function throwForErrorResponse(response: Response): Promise<never> {
  const parsed = await parseBody(response)

  if (response.status === 409) {
    const currentEntry = extractCurrentEntry(parsed)
    if (currentEntry) {
      throw new SyncConflictError(
        response.status,
        parsed,
        currentEntry,
        extractMessage(parsed, 'Entry has been modified since it was last read.'),
      )
    }
  }
  if (response.status === 401 || response.status === 403) {
    throw new SyncAuthError(response.status, parsed, extractMessage(parsed, 'Authentication required.'))
  }
  throw new SyncHttpError(
    response.status,
    parsed,
    extractMessage(parsed, `Request failed with status ${response.status}.`),
  )
}

/** JSON request/response round trip. Returns `undefined` for a 204. */
export async function syncRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await performFetch(path, options)
  if (response.status === 204) return undefined as T
  if (!response.ok) return throwForErrorResponse(response)
  return (await parseBody(response)) as T
}

/** Raw-bytes variant for endpoints that return a file, not JSON (attachment downloads). */
export async function syncRequestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const response = await performFetch(path, options)
  if (!response.ok) return throwForErrorResponse(response)
  return response.blob()
}
