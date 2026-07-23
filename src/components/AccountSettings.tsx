import { useId, useState, type FormEvent } from 'react'
import type { AuthState } from '../hooks/useAuth.ts'
import './AccountSettings.css'

export interface AccountSettingsProps {
  state: AuthState
  pending: boolean
  error: string | null
  onLogin: (password: string) => Promise<boolean>
  onLogout: () => void
}

/**
 * The "Account" row group in SettingsScreen: a small, contextual sign-in
 * surface for the sync backend (`src/lib/sync/authApi.ts`) — never a
 * full-screen gate, per CLAUDE.md's rule that AI/sync unavailability must
 * never block entry capture. Signing in only makes the background outbox
 * (`useSyncOutbox`, `useEntryAttachments`) able to reach protected routes;
 * it changes nothing about local capture either way.
 *
 * `state` has no `'checking'` variant — `useAuth` genuinely doesn't know
 * whether the browser holds a valid session until a request proves it one
 * way or the other (see useAuth.ts's doc comment), so `'unknown'` renders
 * the same sign-in form as `'signedOut'` rather than a misleading spinner.
 */
export function AccountSettings({ state, pending, error, onLogin, onLogout }: AccountSettingsProps) {
  const [password, setPassword] = useState('')
  const fieldId = useId()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!password) return
    const success = await onLogin(password)
    // Only clear on success — a failed attempt keeps the text in place so
    // the user can correct a typo instead of retyping the whole password.
    if (success) setPassword('')
  }

  return (
    // `aria-live="polite"` (not a `role="status"` landmark, to avoid
    // colliding with SettingsScreen's own `role="status"` export region) so
    // the swap between this form and the "Signed in" row — itself an async
    // state change once `onLogin`/`onLogout` settle — is announced, per
    // CLAUDE.md's rule to announce async state through aria-live regions.
    <div className="account-settings" aria-live="polite">
      {state === 'signedIn' ? (
        <div className="account-settings__row">
          <span className="account-settings__row-label">Signed in</span>
          <button
            type="button"
            className="account-settings__button account-settings__button--secondary"
            onClick={onLogout}
            disabled={pending}
          >
            Sign out
          </button>
        </div>
      ) : (
        <form className="account-settings__form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="account-settings__label" htmlFor={fieldId}>
            Password
          </label>
          <div className="account-settings__field-row">
            <input
              id={fieldId}
              type="password"
              className="account-settings__input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={pending}
            />
            <button type="submit" className="account-settings__button" disabled={pending}>
              Sign in
            </button>
          </div>
        </form>
      )}
      {/* Only a live region — and only carries `role="status"` — while
          there's something to announce, so a signed-in/no-error render
          doesn't collide with other `role="status"` regions on the same
          screen (e.g. SettingsScreen's export status). */}
      {error ? (
        <div className="account-settings__status" role="status" aria-live="polite">
          <span className="account-settings__status-text">{error}</span>
        </div>
      ) : (
        <div className="account-settings__status" />
      )}
    </div>
  )
}
