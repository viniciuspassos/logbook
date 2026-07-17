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
