import {
  SyncAuthError,
  SyncConflictError,
  SyncError,
  SyncHttpError,
  SyncNetworkError,
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
