/**
 * Thin adapter over Google Identity Services (GIS) — the only module that
 * touches the `google` global or injects the GIS script, so screens and hooks
 * never do (CLAUDE.md → Layering).
 *
 * The script is loaded lazily from Google, which means it is simply
 * unreachable offline. That is an expected state, not an error: every
 * failure resolves to an `unavailable` result the caller can show, and
 * nothing here ever throws or leaves an unhandled rejection. Signing in is
 * the only thing this affects — the app opens offline from the cached
 * identity (see `useAuth`) without ever loading this script.
 *
 * We render Google's own button (`renderButton`) rather than drawing one: it
 * keeps the official branding, and yields a signed ID token in the
 * callback, which the backend verifies (`POST /auth/google`).
 */

// `hl=en` pins Google's button text to English, matching the rest of the UI
// (the renderButton `locale` option alone follows the browser's language).
const GSI_SRC = 'https://accounts.google.com/gsi/client?hl=en'

export type GoogleUnavailableReason = 'no-client-id' | 'offline'

export type GoogleButtonResult =
  | { status: 'rendered' }
  | { status: 'unavailable'; reason: GoogleUnavailableReason }
  | { status: 'cancelled' }

export interface GoogleSignInOptions {
  /** Called with the signed ID token when the user picks an account. */
  onCredential: (idToken: string) => void
  /** Aborting stops any pending load and silences later credentials. */
  signal?: AbortSignal
  /** The OAuth client ID the backend gave (`GET /auth/config`); `null` when it gave none. */
  clientId: string | null
}

/** How long the GIS script may take before the load counts as failed (offline, blocked, stalled). */
export const SCRIPT_LOAD_TIMEOUT_MS = 8000

// One shared load at a time. On a timeout the tag stays (its request may still
// finish), so a retry reuses it instead of injecting a duplicate.
let pendingLoad: Promise<boolean> | null = null

function isGoogleLoaded(): boolean {
  return typeof google !== 'undefined'
}

function injectScript(): HTMLScriptElement {
  const script = document.createElement('script')
  script.src = GSI_SRC
  script.async = true
  // Permanent: a request that fails long after a caller gave up still drops the dead tag.
  script.addEventListener('error', () => script.remove())
  document.head.appendChild(script)
  return script
}

/** Resolves whether the `google` global exists once the (shared) script settles; `false` on failure or timeout. */
function loadGoogleScript(): Promise<boolean> {
  if (isGoogleLoaded()) return Promise.resolve(true)
  pendingLoad ??= new Promise<boolean>((resolve) => {
    const script = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`) ?? injectScript()
    const finish = (loaded: boolean) => {
      clearTimeout(timer)
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      pendingLoad = null
      resolve(loaded)
    }
    const onLoad = () => {
      const loaded = isGoogleLoaded()
      if (!loaded) script.remove() // loaded without defining `google`: a retry needs a fresh tag
      finish(loaded)
    }
    const onError = () => finish(false)
    const timer = setTimeout(() => finish(false), SCRIPT_LOAD_TIMEOUT_MS)
    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
  })
  return pendingLoad
}

/** Resolves `'aborted'` as soon as the signal fires, else the load's outcome. */
function loadUnlessAborted(signal: AbortSignal | undefined): Promise<boolean | 'aborted'> {
  const load = loadGoogleScript()
  if (!signal) return load
  return new Promise((resolve) => {
    if (signal.aborted) resolve('aborted')
    signal.addEventListener('abort', () => resolve('aborted'), { once: true })
    void load.then(resolve)
  })
}

/** Google's `filled_black` reads better than `outline` on the dark navy panel. */
export function preferredButtonTheme(): GoogleButtonTheme {
  const dark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  return dark ? 'filled_black' : 'outline'
}

type GoogleButtonTheme = NonNullable<GoogleButtonOptions['theme']>

const MIN_BUTTON_WIDTH = 200
const MAX_BUTTON_WIDTH = 400
const FALLBACK_BUTTON_WIDTH = 280

/** GIS only accepts a pixel width between 200 and 400. */
export function clampButtonWidth(containerWidth: number): number {
  const width = Math.round(containerWidth) || FALLBACK_BUTTON_WIDTH
  return Math.min(MAX_BUTTON_WIDTH, Math.max(MIN_BUTTON_WIDTH, width))
}

// GIS warns if `initialize` is called twice, so it runs once per GIS instance:
// the first client ID wins for the page lifetime (it is the server's, and the
// server's doesn't change under a running page). Credentials go to whichever
// button was rendered last.
let initializedGis: unknown = null
let activeOptions: GoogleSignInOptions | null = null

function handleCredential(response: GoogleCredentialResponse): void {
  if (!activeOptions || activeOptions.signal?.aborted) return
  if (typeof response.credential === 'string' && response.credential !== '') {
    activeOptions.onCredential(response.credential)
  }
}

function initializeOnce(clientId: string): void {
  if (initializedGis === google.accounts.id) return
  google.accounts.id.initialize({ client_id: clientId, callback: handleCredential, auto_select: false })
  initializedGis = google.accounts.id
}

/**
 * Loads GIS (if needed) and renders Google's "Continue with Google" button
 * into `container`. Resolves `unavailable` when there's no client ID
 * configured or the script can't be loaded (offline, blocked), and
 * `cancelled` when `signal` aborts first.
 */
export async function renderGoogleSignInButton(
  container: HTMLElement,
  options: GoogleSignInOptions,
): Promise<GoogleButtonResult> {
  const { clientId } = options
  if (!clientId) return { status: 'unavailable', reason: 'no-client-id' }

  const loaded = await loadUnlessAborted(options.signal)
  if (loaded === 'aborted' || options.signal?.aborted) return { status: 'cancelled' }
  if (!loaded) return { status: 'unavailable', reason: 'offline' }

  activeOptions = options
  initializeOnce(clientId)
  google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: preferredButtonTheme(),
    size: 'large',
    text: 'continue_with',
    shape: 'rectangular',
    logo_alignment: 'left',
    width: clampButtonWidth(container.clientWidth),
    locale: 'en',
  })
  return { status: 'rendered' }
}

/**
 * Stops Google from silently re-selecting the last account next time, so
 * "Sign out" really returns to a choice. No-op when GIS never loaded.
 */
export function disableGoogleAutoSelect(): void {
  if (!isGoogleLoaded()) return
  try {
    google.accounts.id.disableAutoSelect()
  } catch {
    // Best-effort: the local sign-out has already happened.
  }
}
