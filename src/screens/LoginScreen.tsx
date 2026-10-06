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
  /** Called with the signed Google ID token when the user picks an account. */
  onCredential: (idToken: string) => void
}

type ButtonState = 'loading' | 'ready' | 'offline' | 'unconfigured'

const BUTTON_MESSAGE: Record<ButtonState, string> = {
  loading: '',
  ready: '',
  offline: "Couldn't reach Google. Check your connection and try again.",
  unconfigured: "Sign-in isn't set up for this Logbook yet.",
}

/**
 * The gate shown by `App.tsx` while there is no known identity. Google is the
 * only way in; Google's own button is rendered into the slot by
 * `renderGoogleSignInButton` (lib/auth/googleIdentity.ts keeps the `google`
 * global and the script load out of the screen). Everything async — loading
 * the script, verifying the token — is announced in one polite live region
 * whose height is reserved so messages never shift the layout.
 *
 * Offline the Google script can't load; that reads as a message with a retry,
 * never an exception. A returning user who signed in before doesn't see this
 * screen offline at all (see `useAuth`).
 */
export function LoginScreen({ pending, error, onCredential }: LoginScreenProps) {
  const slotRef = useRef<HTMLDivElement>(null)
  const [buttonState, setButtonState] = useState<ButtonState>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    const controller = new AbortController()
    void renderGoogleSignInButton(slot, { onCredential, signal: controller.signal }).then((result) => {
      if (result.status === 'cancelled' || controller.signal.aborted) return
      if (result.status === 'rendered') setButtonState('ready')
      else setButtonState(result.reason === 'offline' ? 'offline' : 'unconfigured')
    })
    return () => controller.abort()
  }, [attempt, onCredential])

  function retry() {
    setButtonState('loading')
    setAttempt((current) => current + 1)
  }

  const message = pending ? 'Signing in…' : (error ?? BUTTON_MESSAGE[buttonState])
  const isProblem = !pending && message !== ''
  const showSlot = buttonState === 'loading' || buttonState === 'ready'

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
          hidden={!showSlot}
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
      </div>
    </main>
  )
}
