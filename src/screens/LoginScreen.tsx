import { useEffect, useRef, useState } from 'react'
import type { AuthProfile } from '../types/auth.ts'
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
  /** A different account signed in and must confirm replacing this device's data. */
  pendingSwitch: AuthProfile | null
  onConfirmSwitch: () => void
  onCancelSwitch: () => void
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
function useGoogleButton(onCredential: (idToken: string) => void) {
  const slotRef = useRef<HTMLDivElement>(null)
  const [buttonState, setButtonState] = useState<ButtonState>('loading')
  const [attempt, setAttempt] = useState(0)
  // The effect below must not re-run (and re-render Google's button) just
  // because the parent passed a new callback, so it calls through a ref.
  const onCredentialRef = useRef(onCredential)
  useEffect(() => {
    onCredentialRef.current = onCredential
  }, [onCredential])

  // Re-runs only for a retry. On a retry the slot has been un-hidden by the
  // same render that bumped `attempt`, so Google's button is measured against
  // a laid-out container rather than the hidden offline one.
  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    const controller = new AbortController()
    const options = { onCredential: (idToken: string) => onCredentialRef.current(idToken), signal: controller.signal }
    void renderGoogleSignInButton(slot, options).then((result) => {
      if (result.status === 'cancelled' || controller.signal.aborted) return
      if (result.status === 'rendered') setButtonState('ready')
      else setButtonState(result.reason === 'offline' ? 'offline' : 'unconfigured')
    })
    return () => {
      controller.abort()
      slot.replaceChildren()
    }
  }, [attempt])

  const retry = () => {
    setButtonState('loading')
    setAttempt((current) => current + 1)
  }
  return { slotRef, buttonState, retry }
}

interface SwitchConfirmProps {
  account: AuthProfile
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Asks before replacing another account's local entries (shown instead of Google's button). */
function SwitchConfirm({ account, pending, onConfirm, onCancel }: SwitchConfirmProps) {
  return (
    <div className="login__switch">
      <p className="login__switch-text">
        This device holds entries from a different Google account. Continuing as <strong>{account.email}</strong>{' '}
        removes them from this device, including anything that hasn&apos;t synced.
      </p>
      <div className="login__switch-actions">
        <button type="button" className="login__primary" onClick={onConfirm} disabled={pending}>
          Remove them and continue
        </button>
        <button type="button" className="login__retry" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * The gate shown by `App.tsx` while there is no known identity (or over the
 * running app for a "sign in again"). Google is the only way in; Google's own
 * button is rendered into the slot by `renderGoogleSignInButton`
 * (lib/auth/googleIdentity.ts keeps the `google` global and the script load
 * out of the screen). Everything async — loading the script, verifying the
 * token — is announced in one polite live region whose height is reserved so
 * messages never shift the layout.
 *
 * Offline the Google script can't load; that reads as a message with a retry,
 * never an exception. A returning user who signed in before doesn't see this
 * screen offline at all (see `useAuth`).
 */
export function LoginScreen({
  pending,
  error,
  onCredential,
  pendingSwitch,
  onConfirmSwitch,
  onCancelSwitch,
  onDismiss,
}: LoginScreenProps) {
  const { slotRef, buttonState, retry } = useGoogleButton(onCredential)
  const message = statusFor(pending, error, buttonState)
  const isProblem = !pending && message !== ''
  const googleUsable = buttonState === 'loading' || buttonState === 'ready'

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
          hidden={!googleUsable || pendingSwitch !== null}
        />
        {pendingSwitch !== null && (
          <SwitchConfirm account={pendingSwitch} pending={pending} onConfirm={onConfirmSwitch} onCancel={onCancelSwitch} />
        )}
        {buttonState === 'offline' && pendingSwitch === null && (
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
