/** The signed-in Google account, as returned by the backend's `GET /auth/me`. */
export interface AuthProfile {
  id: string | number
  email: string
  name: string | null
  picture: string | null
}
