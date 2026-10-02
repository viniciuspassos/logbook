import type { ServerEntry } from '../../types/sync.ts'

/**
 * Error hierarchy for the sync client. Every failure mode a caller needs to
 * branch on (offline vs. a real HTTP error vs. an auth challenge vs. a #24
 * version conflict) gets its own class rather than string-matching a
 * message, so `instanceof` narrowing works without `any`.
 */

/** Base class for anything the sync layer throws. */
export class SyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncError'
  }
}

/** `fetch` itself failed (offline, DNS, connection refused) or is absent. */
export class SyncNetworkError extends SyncError {
  constructor(message = 'Could not reach the server.') {
    super(message)
    this.name = 'SyncNetworkError'
  }
}

/** The server responded, but with a non-2xx status. */
export class SyncHttpError extends SyncError {
  status: number
  body: unknown

  constructor(status: number, body: unknown, message: string) {
    super(message)
    this.name = 'SyncHttpError'
    this.status = status
    this.body = body
  }
}

/** 401/403 — no session, or an expired/invalid one. */
export class SyncAuthError extends SyncHttpError {
  constructor(status: number, body: unknown, message = 'Authentication required.') {
    super(status, body, message)
    this.name = 'SyncAuthError'
  }
}

/** 409 on a PATCH — the entry moved on since the version this edit was based on. */
export class SyncConflictError extends SyncHttpError {
  currentEntry: ServerEntry

  constructor(status: number, body: unknown, currentEntry: ServerEntry, message: string) {
    super(status, body, message)
    this.name = 'SyncConflictError'
    this.currentEntry = currentEntry
  }
}

// 4xx statuses that can still succeed on a later attempt without the op
// itself changing: a timeout (408) or rate limit (429). 401/403 are
// SyncAuthError (signing in fixes them) and 409 is #24's conflict, which has
// its own "stay queued until resolved" semantics.
const RETRYABLE_CLIENT_STATUSES = new Set([401, 403, 408, 409, 429])

/**
 * Whether the server rejected an op in a way that will fail identically
 * forever (400/413/415/422…), so the outbox must park it rather than retry it
 * at the head of the queue (#91). Network errors and 5xx stay retryable.
 */
export function isPermanentRejection(error: unknown): boolean {
  if (!(error instanceof SyncHttpError)) return false
  return error.status >= 400 && error.status < 500 && !RETRYABLE_CLIENT_STATUSES.has(error.status)
}
