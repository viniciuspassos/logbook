import { useEffect, useRef, useState } from 'react'
import { ContourArt } from '../components/ContourArt.tsx'
import { cx } from '../lib/cx.ts'
import { renderGoogleSignInButton } from '../lib/auth/googleIdentity.ts'
import './LoginScreen.css'

export interface LoginScreenProps {
  /** A sign-in is being verified by the backend. */
  pending: boolean
  /** The last sign-in failure, in plain words. */
  error: string | null
  /** The OAuth client ID the server gave (`GET /auth/config`). */
  clientId: string | null
  /** Called with the signed Google ID token when the user picks an account. */
  onCredential: (idToken: string) => void
  /** Set when this is shown over the running app (a "sign in again"), so it can be closed. */
  onDismiss?: () => void
}

type ButtonState = 'loading' | 'ready' | 'offline' | 'unconfigured'

const BUTTON_MESSAGE: Record<ButtonState, string> = {
  loading: '',
  ready: '',
  offline: "Couldn't reach Google. Check your connection and try again.",
  unconfigured: "Sign-in isn't set up for this Logbook yet.",
}

/** One line for the live region: progress first, then a server error, then Google's own state. */
function statusFor(pending: boolean, error: string | null, buttonState: ButtonState): string {
  if (pending) return 'Signing in…'
  // `||`, not `??`: an empty error must not hide Google's own status.
  return error || BUTTON_MESSAGE[buttonState]
}

/** Loads and renders Google's button into the returned slot; `retry` tries again after an offline failure. */
function useGoogleButton(clientId: string | null, onCredential: (idToken: string) => void) {
  const slotRef = useRef<HTMLDivElement>(null)
  const [buttonState, setButtonState] = useState<ButtonState>('loading')
  const [attempt, setAttempt] = useState(0)
  // `onCredential` changes with session state; the button must survive that, so it is called through a ref.
  const onCredentialRef = useRef(onCredential)
  useEffect(() => {
    onCredentialRef.current = onCredential
  }, [onCredential])

  // On a retry the slot has been un-hidden by the same render that bumped
  // `attempt`, so Google's button is measured against a laid-out container.
  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    const controller = new AbortController()
    const options = {
      clientId,
      onCredential: (idToken: string) => onCredentialRef.current(idToken),
      signal: controller.signal,
    }
    void renderGoogleSignInButton(slot, options).then((result) => {
      if (result.status === 'cancelled' || controller.signal.aborted) return
      if (result.status === 'rendered') setButtonState('ready')
      else setButtonState(result.reason === 'offline' ? 'offline' : 'unconfigured')
    })
    return () => {
      controller.abort()
      slot.replaceChildren()
    }
  }, [attempt, clientId])

  const retry = () => {
    setButtonState('loading')
    setAttempt((current) => current + 1)
  }
  return { slotRef, buttonState, retry }
}

/**
 * The gate shown while there is no known identity (or over the running app for a
 * "sign in again"). Google's own button is rendered into the slot by
 * `renderGoogleSignInButton`; everything async is announced in one polite live
 * region with reserved height. Offline reads as a message with a retry.
 */
export function LoginScreen({ pending, error, clientId, onCredential, onDismiss }: LoginScreenProps) {
  const { slotRef, buttonState, retry } = useGoogleButton(clientId, onCredential)
  const message = statusFor(pending, error, buttonState)
  const isProblem = !pending && message !== ''

  return (
    <main className="login">
      <div className="login__art" aria-hidden="true">
        <ContourArt />
      </div>

      <div className="login__panel">
        <h1 className="login__title">Logbook</h1>
        <p className="login__lede">Record climbs and jumps, even with no signal.</p>
        <p className="login__note">Sign in once. After that, Logbook opens offline.</p>

        <div
          ref={slotRef}
          className={cx('login__google', pending && 'is-pending')}
          data-state={buttonState}
          hidden={buttonState === 'offline' || buttonState === 'unconfigured'}
        />
        {buttonState === 'offline' && (
          <button type="button" className="login__retry" onClick={retry}>
            Try again
          </button>
        )}

        <div
          className={cx('login__status', isProblem && 'login__status--problem')}
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
        {onDismiss && (
          <button type="button" className="login__dismiss" onClick={onDismiss}>
            Not now
          </button>
        )}
      </div>
    </main>
  )
}
