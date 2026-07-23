import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuth } from './useAuth.ts'
import { login, logout } from '../lib/sync/authApi.ts'
import { drainOutbox } from '../lib/sync/outboxRunner.ts'
import { SyncAuthError, SyncNetworkError } from '../lib/sync/errors.ts'

jest.mock('../lib/sync/authApi.ts', () => ({
  login: jest.fn(),
  logout: jest.fn(),
}))
jest.mock('../lib/sync/outboxRunner.ts', () => ({
  drainOutbox: jest.fn().mockResolvedValue({ processed: 0, stoppedReason: 'empty' }),
}))

const loginMock = login as jest.Mock
const logoutMock = logout as jest.Mock
const drainMock = drainOutbox as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  loginMock.mockResolvedValue({ status: 'ok' })
  logoutMock.mockResolvedValue({ status: 'ok' })
  drainMock.mockResolvedValue({ processed: 0, stoppedReason: 'empty' })
})

describe('useAuth', () => {
  it('starts in the "unknown" state — this app has no session-status endpoint to check on mount', () => {
    const { result } = renderHook(() => useAuth())
    expect(result.current.state).toBe('unknown')
    expect(result.current.pending).toBe(false)
    expect(result.current.error).toBeNull()
  })

  describe('login', () => {
    it('calls the auth API with the password and moves to "signedIn" on success', async () => {
      const { result } = renderHook(() => useAuth())

      let outcome: boolean | undefined
      await act(async () => {
        outcome = await result.current.login('hunter2')
      })

      expect(loginMock).toHaveBeenCalledWith('hunter2')
      expect(result.current.state).toBe('signedIn')
      expect(outcome).toBe(true)
    })

    it('is pending while the request is in flight', async () => {
      let resolveLogin: (() => void) | undefined
      loginMock.mockReturnValue(
        new Promise((resolve) => {
          resolveLogin = () => resolve({ status: 'ok' })
        }),
      )
      const { result } = renderHook(() => useAuth())

      act(() => {
        void result.current.login('hunter2')
      })
      expect(result.current.pending).toBe(true)

      await act(async () => {
        resolveLogin?.()
      })
      expect(result.current.pending).toBe(false)
    })

    it('kicks an outbox drain on success, so anything queued while logged out flushes immediately', async () => {
      const { result } = renderHook(() => useAuth())
      await act(async () => {
        await result.current.login('hunter2')
      })
      expect(drainMock).toHaveBeenCalled()
    })

    it('moves to "signedOut" and reports "Incorrect password" on a 401', async () => {
      loginMock.mockRejectedValue(new SyncAuthError(401, null, 'Invalid password'))
      const { result } = renderHook(() => useAuth())

      let outcome: boolean | undefined
      await act(async () => {
        outcome = await result.current.login('wrong')
      })

      expect(result.current.state).toBe('signedOut')
      expect(result.current.error).toBe('Incorrect password.')
      expect(outcome).toBe(false)
    })

    it('reports a network message without claiming the user is signed out on a connectivity failure', async () => {
      loginMock.mockRejectedValue(new SyncNetworkError())
      const { result } = renderHook(() => useAuth())

      await act(async () => {
        await result.current.login('hunter2')
      })

      expect(result.current.state).toBe('unknown')
      expect(result.current.error).toBe('Could not reach the server. Check your connection and try again.')
    })
  })

  describe('logout', () => {
    it('calls the auth API and moves to "signedOut"', async () => {
      const { result } = renderHook(() => useAuth())
      await act(async () => {
        await result.current.login('hunter2')
      })

      await act(async () => {
        await result.current.logout()
      })

      expect(logoutMock).toHaveBeenCalledTimes(1)
      expect(result.current.state).toBe('signedOut')
    })

    it('still degrades to "signedOut" locally even when the request itself fails', async () => {
      logoutMock.mockRejectedValue(new SyncNetworkError())
      const { result } = renderHook(() => useAuth())

      await act(async () => {
        await result.current.logout()
      })

      expect(result.current.state).toBe('signedOut')
    })
  })

  describe('noteAuthRequired', () => {
    it('flips the state to "signedOut", e.g. when the outbox hits a 401 mid-drain', () => {
      const { result } = renderHook(() => useAuth())
      act(() => result.current.noteAuthRequired())
      expect(result.current.state).toBe('signedOut')
    })
  })

  describe('noteAuthConfirmed', () => {
    it('flips the state to "signedIn", e.g. when a queued sync op succeeds without ever calling login()', () => {
      const { result } = renderHook(() => useAuth())
      act(() => result.current.noteAuthConfirmed())
      expect(result.current.state).toBe('signedIn')
    })
  })

  describe('clearError', () => {
    it('resets the error back to null', async () => {
      loginMock.mockRejectedValue(new SyncAuthError(401, null, 'Invalid password'))
      const { result } = renderHook(() => useAuth())
      await act(async () => {
        await result.current.login('wrong')
      })
      expect(result.current.error).not.toBeNull()

      act(() => result.current.clearError())
      expect(result.current.error).toBeNull()
    })
  })

  it('never throws out of login even if the underlying request rejects', async () => {
    loginMock.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await expect(result.current.login('x')).resolves.toBe(false)
    })
    await waitFor(() => expect(result.current.pending).toBe(false))
  })
})
