import { ShapeGlyph } from './ShapeGlyph.tsx'
import type { AdventureShape } from '../types/entry.ts'
import './AdventureBadge.css'

interface AdventureBadgeProps {
  shape: AdventureShape
}

const SIZE = 22

/** Small accent-colored marker distinguishing an entry's adventure type. */
export function AdventureBadge({ shape }: AdventureBadgeProps) {
  return (
    <div
      className="adventure-badge"
      style={{ width: SIZE, height: SIZE, borderRadius: SIZE * (7 / 22) }}
    >
      <ShapeGlyph shape={shape} size={SIZE * 0.4} />
    </div>
  )
}
