/** The signed-in Google account, as returned by the backend's `GET /auth/me`. */
export interface AuthProfile {
  id: string | number
  email: string
  name: string | null
  picture: string | null
}

export type AuthState = 'loading' | 'signedIn' | 'signedOut'

/**
 * Where the sign-in gate stands.
 *
 * - `unverified`: the app is open on the strength of a cached profile (or, with
 *   no profile, on local entries alone) but `GET /auth/me` hasn't confirmed the
 *   session yet, e.g. because the backend was unreachable. It is verified
 *   in the background once a sync attempt reaches the server again.
 * - `pendingSwitch`: the user signed in as a different Google account than the
 *   one that owns this device's local entries. Nothing opens until they
 *   confirm that the old account's local data is removed.
 */
export interface Session {
  state: AuthState
  profile: AuthProfile | null
  unverified: boolean
  pendingSwitch: AuthProfile | null
}
