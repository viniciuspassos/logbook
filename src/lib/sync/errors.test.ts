import {
  SyncAuthError,
  SyncConflictError,
  SyncError,
  SyncHttpError,
  SyncNetworkError,
  isPermanentRejection,
} from './errors.ts'
import type { ServerEntry } from '../../types/sync.ts'

describe('SyncError', () => {
  it('carries a message and instanceof Error', () => {
    const error = new SyncError('boom')
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('boom')
    expect(error.name).toBe('SyncError')
  })
})

describe('SyncNetworkError', () => {
  it('defaults to an unreachable-server message', () => {
    expect(new SyncNetworkError().message).toBe('Could not reach the server.')
  })

  it('accepts a custom message', () => {
    expect(new SyncNetworkError('offline').message).toBe('offline')
  })
})

describe('SyncHttpError', () => {
  it('carries status and body, and is a SyncError', () => {
    const error = new SyncHttpError(500, { detail: 'x' }, 'server error')
    expect(error).toBeInstanceOf(SyncError)
    expect(error.status).toBe(500)
    expect(error.body).toEqual({ detail: 'x' })
    expect(error.message).toBe('server error')
  })
})

describe('SyncAuthError', () => {
  it('is a SyncHttpError with a default message', () => {
    const error = new SyncAuthError(401, null)
    expect(error).toBeInstanceOf(SyncHttpError)
    expect(error.status).toBe(401)
    expect(error.message).toBe('Authentication required.')
  })
})

describe('SyncConflictError', () => {
  it('carries the current server entry', () => {
    const currentEntry = { id: 1, version: 3 } as ServerEntry
    const error = new SyncConflictError(409, {}, currentEntry, 'conflict')
    expect(error).toBeInstanceOf(SyncHttpError)
    expect(error.currentEntry).toBe(currentEntry)
    expect(error.status).toBe(409)
  })
})

describe('isPermanentRejection', () => {
  it.each([400, 404, 413, 415, 422])('treats a %i response as a permanent rejection', (status) => {
    expect(isPermanentRejection(new SyncHttpError(status, null, 'rejected'))).toBe(true)
  })

  it.each([408, 429, 500, 503])('treats a %i response as retryable', (status) => {
    expect(isPermanentRejection(new SyncHttpError(status, null, 'try later'))).toBe(false)
  })

  it('leaves auth failures retryable so signing in can unblock them', () => {
    expect(isPermanentRejection(new SyncAuthError(401, null))).toBe(false)
    expect(isPermanentRejection(new SyncAuthError(403, null))).toBe(false)
  })

  it('leaves a #24 version conflict queued rather than parking it', () => {
    const conflict = new SyncConflictError(409, null, {} as ServerEntry, 'conflict')
    expect(isPermanentRejection(conflict)).toBe(false)
  })

  it('treats network failures and non-HTTP errors as retryable', () => {
    expect(isPermanentRejection(new SyncNetworkError())).toBe(false)
    expect(isPermanentRejection(new Error('boom'))).toBe(false)
    expect(isPermanentRejection('boom')).toBe(false)
  })
})
