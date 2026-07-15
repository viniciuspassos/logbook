import type { CSSProperties } from 'react'
import './PhotoPlaceholder.css'

interface PhotoPlaceholderProps {
  hint: string
  shape?: 'rounded' | 'rect' | 'circle'
  radius?: number
}

/**
 * Stands in for a photo the offline-first app has no storage for yet.
 * Shows the caption a real photo would eventually fill.
 */
export function PhotoPlaceholder({
  hint,
  shape = 'rounded',
  radius = 12,
}: PhotoPlaceholderProps) {
  const style: CSSProperties = {}
  if (shape === 'circle') style.borderRadius = '50%'
  else if (shape === 'rounded') style.borderRadius = radius

  return (
    <div className="photo-placeholder" style={style} role="img" aria-label={hint}>
      <span className="photo-placeholder__hint">{hint}</span>
    </div>
  )
}
