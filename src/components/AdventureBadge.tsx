import { ShapeGlyph } from './ShapeGlyph.tsx'
import type { AdventureShape } from '../types/entry.ts'
import './AdventureBadge.css'

interface AdventureBadgeProps {
  shape: AdventureShape
  size?: number
}

/** Small accent-colored marker distinguishing an entry's adventure type. */
export function AdventureBadge({ shape, size = 22 }: AdventureBadgeProps) {
  return (
    <div
      className="adventure-badge"
      style={{ width: size, height: size, borderRadius: size * (7 / 22) }}
    >
      <ShapeGlyph shape={shape} size={size * 0.4} />
    </div>
  )
}
