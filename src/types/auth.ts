/** The signed-in Google account, as returned by the backend's `GET /auth/me`. */
export interface AuthProfile {
  id: string | number
  email: string
  name: string | null
  picture: string | null
}

export type AuthState = 'loading' | 'signedIn' | 'signedOut'

/**
 * Where the sign-in gate stands. `unverified`: the app is open on a cached
 * identity (or local entries alone) but `GET /auth/me` hasn't confirmed the
 * session yet; it is confirmed when the app regains the network or focus.
 * `notice`: set when this device's local data was wiped because a different
 * account signed in.
 */
export interface Session {
  state: AuthState
  profile: AuthProfile | null
  unverified: boolean
  notice: string | null
}
