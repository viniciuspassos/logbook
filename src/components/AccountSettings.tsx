import { useState } from 'react'
import type { AuthProfile } from '../types/auth.ts'
import { avatarInitial } from './avatarInitial.ts'
import './AccountSettings.css'

export interface AccountSettingsProps {
  /** The signed-in account; `null` when it isn't known (shows a plain row). */
  profile: AuthProfile | null
  pending: boolean
  /** Sign-out progress or an error, announced politely; `null` when there is nothing to say. */
  status: string | null
  onLogout: () => void
}

function Avatar({ profile }: { profile: AuthProfile }) {
  // Google's picture is a remote URL, so it may fail with no signal; the
  // initial is the offline-safe fallback.
  const [failed, setFailed] = useState(false)
  if (profile.picture && !failed) {
    return (
      <img
        className="account-settings__avatar"
        src={profile.picture}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span className="account-settings__avatar account-settings__avatar--initial" aria-hidden="true">
      {avatarInitial(profile)}
    </span>
  )
}

/**
 * The "Account" row in SettingsScreen: who is signed in, plus Sign out.
 * Signing in lives on the login gate (`LoginScreen`), not here — by the time
 * Settings is reachable there is a known identity.
 */
export function AccountSettings({ profile, pending, status, onLogout }: AccountSettingsProps) {
  return (
    <div className="account-settings">
      <div className="account-settings__row">
        {profile ? (
          <div className="account-settings__identity">
            <Avatar key={`${profile.id}:${profile.picture}`} profile={profile} />
            <div className="account-settings__text">
              {profile.name && <span className="account-settings__name">{profile.name}</span>}
              <span className="account-settings__email">{profile.email}</span>
            </div>
          </div>
        ) : (
          <span className="account-settings__name">Signed in</span>
        )}
        <button
          type="button"
          className="account-settings__button account-settings__button--secondary"
          onClick={onLogout}
          disabled={pending}
        >
          Sign out
        </button>
      </div>
      <p className="account-settings__hint">Signing out removes this device's entries (they stay on the server).</p>
      {/* Reserved height, so progress or an error never shifts the group. */}
      <div className="account-settings__status" aria-live="polite">
        {status}
      </div>
    </div>
  )
}
