import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import {
  LOADING_CONFIG,
  UNKNOWN_CONFIG,
  googleClientIdOf,
  knownConfig,
  modeOfConfigState,
  sameConfigState,
  type AuthMode,
  type ConfigState,
} from '../lib/auth/authConfig.ts'
import {
  STARTUP_TIMEOUT_MS,
  refreshAuthConfig,
  resolveAuthConfig,
  startupFallback,
} from '../lib/auth/sessionFlows.ts'
import { shouldUseMockData } from '../lib/config/mockData.ts'
import { useRetryWhileActive } from './useRetryWhileActive.ts'

export interface AuthModeState {
  mode: AuthMode
  /** The OAuth client ID the server gave, in `google` mode. */
  googleClientId: string | null
}

/**
 * A slow start: a device we already know (cached identity or local entries)
 * opens as `unknown`, i.e. local-only; a first-time device keeps waiting for the
 * answer. Never overwrites a real answer.
 */
async function openIfKnownDevice(signal: AbortSignal, setState: Dispatch<SetStateAction<ConfigState>>) {
  const known = await startupFallback()
  if (known && !signal.aborted) setState((cur) => (cur.status === 'loading' ? UNKNOWN_CONFIG : cur))
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
    const timer = setTimeout(() => void openIfKnownDevice(controller.signal, setState), STARTUP_TIMEOUT_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [mock, update, setState])
}

/** While the config is unknown, ask again: now, every 30 seconds, and whenever the app may be reachable. */
function useRetryWhileUnknown(unknown: boolean, update: (next: ConfigState) => void) {
  useRetryWhileActive(unknown, async () => {
    const config = await refreshAuthConfig()
    if (config) update(knownConfig(config))
    return config !== null
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
