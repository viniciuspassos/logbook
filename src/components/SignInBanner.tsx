import './SignInBanner.css'

export interface SignInBannerProps {
  onSignIn: () => void
}

/**
 * A non-blocking notice that the session has expired: a background sync
 * request got a 401. It deliberately doesn't replace the app (that would throw
 * away an in-progress capture draft); entries keep saving locally and the
 * outbox waits. Announced politely, since it appears without user action.
 */
export function SignInBanner({ onSignIn }: SignInBannerProps) {
  return (
    <div className="signin-banner" role="status" aria-live="polite">
      <span className="signin-banner__text">Sign in again to resume syncing.</span>
      <button type="button" className="signin-banner__button" onClick={onSignIn}>
        Sign in
      </button>
    </div>
  )
}
