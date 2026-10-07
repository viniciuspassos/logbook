// Ambient declarations for Google Identity Services (GIS), loaded lazily from
// https://accounts.google.com/gsi/client. Only the surface Logbook consumes is
// declared. Runtime code guards with `typeof google === 'undefined'` (see
// src/lib/auth/googleIdentity.ts), so a script that never loaded (offline,
// blocked) degrades instead of throwing.

interface GoogleCredentialResponse {
  /** The signed ID token (a JWT) to send to the backend for verification. */
  credential?: string
  select_by?: string
}

interface GoogleIdInitializeOptions {
  client_id: string
  callback: (response: GoogleCredentialResponse) => void
  auto_select?: boolean
}

interface GoogleButtonOptions {
  type?: 'standard' | 'icon'
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'large' | 'medium' | 'small'
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
  shape?: 'rectangular' | 'pill'
  logo_alignment?: 'left' | 'center'
  /** In pixels, 200-400. */
  width?: number
  locale?: string
}

declare namespace google.accounts.id {
  function initialize(options: GoogleIdInitializeOptions): void
  function renderButton(parent: HTMLElement, options: GoogleButtonOptions): void
  function disableAutoSelect(): void
  function cancel(): void
}
