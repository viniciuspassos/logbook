import './SignInBanner.css'

export interface SignInBannerProps {
  message: string
  /** Shows a "Sign in" button; leave out for a plain notice. */
  onSignIn?: () => void
  onDismiss: () => void
  dismissLabel?: string
}

/**
 * A non-blocking notice, fixed to the top: either "sign in again" (a background
 * sync request got a 401) or a plain message such as "your entries were
 * removed". It deliberately doesn't replace the app (that would throw away an
 * in-progress capture draft). Announced politely, since it appears without
 * user action.
 */
export function SignInBanner({ message, onSignIn, onDismiss, dismissLabel = 'Not now' }: SignInBannerProps) {
  return (
    <div className="signin-banner" role="status" aria-live="polite">
      <span>{message}</span>
      {onSignIn && (
        <button type="button" className="signin-banner__button" onClick={onSignIn}>
          Sign in
        </button>
      )}
      <button type="button" className="signin-banner__dismiss" onClick={onDismiss}>
        {dismissLabel}
      </button>
    </div>
  )
}
