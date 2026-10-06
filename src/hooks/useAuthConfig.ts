import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import {
  LOADING_CONFIG,
  googleClientIdOf,
  knownConfig,
  modeOfConfigState,
  sameConfigState,
  type AuthMode,
  type ConfigState,
} from '../lib/auth/authConfig.ts'
import {
  RESTORE_TIMEOUT_MS,
  refreshAuthConfig,
  resolveAuthConfig,
  resolveStuckConfig,
} from '../lib/auth/sessionFlows.ts'
import { shouldUseMockData } from '../lib/config/mockData.ts'
import { useBackoffRetry } from './useBackoffRetry.ts'

export interface AuthModeState {
  mode: AuthMode
  /** The OAuth client ID the server gave, in `google` mode. */
  googleClientId: string | null
}

/** Fills in a startup that is still waiting (see resolveStuckConfig); never overwrites a real answer. */
async function openIfStuck(signal: AbortSignal, setState: Dispatch<SetStateAction<ConfigState>>) {
  const next = await resolveStuckConfig()
  if (next && !signal.aborted) setState((cur) => (cur.status === 'loading' ? next : cur))
}

/** Startup: cached config first, then the server's answer, with the slow-start rules of `useAuth`. */
function useStartupConfig(
  mock: boolean,
  update: (next: ConfigState) => void,
  setState: Dispatch<SetStateAction<ConfigState>>,
) {
  useEffect(() => {
    if (mock) return
    const controller = new AbortController()
    void resolveAuthConfig(controller.signal, (next) => {
      if (!controller.signal.aborted) update(next)
    })
    // The same rule as a slow `GET /auth/me`: an existing user (or stuck
    // storage) opens local-only as `unknown`; a first-time user keeps waiting.
    const timer = setTimeout(() => void openIfStuck(controller.signal, setState), RESTORE_TIMEOUT_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [mock, update, setState])
}

/** While the config is unknown, ask the server again: on a backoff timer and whenever connectivity returns. */
function useRetryWhileUnknown(unknown: boolean, update: (next: ConfigState) => void) {
  useBackoffRetry(unknown, async (signal) => {
    const config = await refreshAuthConfig(signal)
    if (!config || signal.aborted) return false
    update(knownConfig(config))
    return true
  })
}

/**
 * Which login the server wants, resolved in one place (see authConfig.ts for
 * the modes). Authentication is the backend's call: the app asks
 * `GET /auth/config` and caches the last good answer so it can decide offline.
 * With no answer and no cache the mode is `unknown`, which opens the app
 * local-only (never a trap for an offline user) and asks again on reconnect.
 * `dev:mocked` stays its own mode.
 */
export function useAuthConfig(): AuthModeState {
  const mock = shouldUseMockData()
  const [state, setState] = useState<ConfigState>(LOADING_CONFIG)
  // A re-fetch of an unchanged config must not re-render everything under it.
  const update = useCallback(
    (next: ConfigState) => setState((cur) => (sameConfigState(cur, next) ? cur : next)),
    [],
  )

  useStartupConfig(mock, update, setState)
  useRetryWhileUnknown(!mock && state.status === 'unknown', update)

  if (mock) return { mode: 'mock', googleClientId: null }
  return {
    mode: modeOfConfigState(state),
    googleClientId: state.status === 'known' ? googleClientIdOf(state.config) : null,
  }
}
