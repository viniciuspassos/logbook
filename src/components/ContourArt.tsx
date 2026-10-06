import type { CSSProperties } from 'react'
import { contourRings } from './contourPaths.ts'
import './ContourArt.css'

const RINGS = contourRings()
const SUMMIT = { x: 200, y: 200 }

/**
 * The login screen's one bold element: topographic contour lines around a
 * summit, which also reads as a drop-zone target seen from above. The single
 * orange dot is the only accent. Decorative, so it's hidden from assistive
 * tech; sized by its container (it slices to fill, never letterboxes).
 */
export function ContourArt() {
  return (
    <svg
      className="contour-art"
      viewBox="0 0 400 400"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {RINGS.map((ring, index) => (
        <path
          key={index}
          d={ring.d}
          className={ring.major ? 'contour-art__ring contour-art__ring--major' : 'contour-art__ring'}
          style={{ '--ring': index } as CSSProperties}
        />
      ))}
      <circle className="contour-art__halo" cx={SUMMIT.x} cy={SUMMIT.y} r="11" />
      <circle className="contour-art__summit" cx={SUMMIT.x} cy={SUMMIT.y} r="4.5" />
    </svg>
  )
}
