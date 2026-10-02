import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../lib/cx.ts'
import './ConfirmButton.css'

interface ConfirmButtonProps {
  /** What the action does — the button's accessible name, and its visible
   *  text unless `children` overrides that (e.g. an icon). */
  label: string
  /** The destructive button shown once armed, e.g. "Delete". */
  confirmLabel: string
  cancelLabel?: string
  disabled?: boolean
  className?: string
  children?: ReactNode
  onConfirm: () => void
}

/**
 * A button for destructive actions that asks before acting: the first click
 * swaps it for an inline confirm/cancel pair, and only the confirm calls
 * `onConfirm`. Inline rather than `window.confirm`, which would block the page
 * and can't be styled or announced like the rest of the app. Focus moves to
 * the confirm button when armed so keyboard users land on the choice; Escape
 * or Cancel backs out and puts focus back on the trigger.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  cancelLabel = 'Cancel',
  disabled = false,
  className,
  children,
  onConfirm,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Set when the user backs out, so focus returns to the trigger instead of
  // falling to <body> as the confirm/cancel pair unmounts. Not after a
  // confirm: the action usually removes the trigger's whole context.
  const restoreFocusRef = useRef(false)

  useEffect(() => {
    if (armed) {
      confirmRef.current?.focus()
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false
      triggerRef.current?.focus()
    }
  }, [armed])

  function disarm() {
    restoreFocusRef.current = true
    setArmed(false)
  }

  if (!armed) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className={cx('confirm-button', className)}
        aria-label={children === undefined ? undefined : label}
        disabled={disabled}
        onClick={() => setArmed(true)}
      >
        {children ?? label}
      </button>
    )
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') disarm()
  }

  return (
    <span
      role="group"
      aria-label={label}
      className={cx('confirm-button', 'confirm-button--armed', className)}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={confirmRef}
        type="button"
        className="confirm-button__confirm"
        disabled={disabled}
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="confirm-button__cancel" onClick={disarm}>
        {cancelLabel}
      </button>
    </span>
  )
}
