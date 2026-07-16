import './OverlayHeader.css'

interface OverlayHeaderProps {
  /** Text shown next to the back chevron (e.g. "Back", "Cancel"). */
  label: string
  onBack: () => void
}

/** Shared back-chevron header used by the entry-detail and new-entry overlays. */
export function OverlayHeader({ label, onBack }: OverlayHeaderProps) {
  return (
    <div className="overlay-header">
      <button type="button" className="overlay-header__back" onClick={onBack}>
        ‹
      </button>
      <span className="overlay-header__back-label">{label}</span>
    </div>
  )
}
