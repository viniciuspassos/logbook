import { contourRings } from './contourPaths.ts'

const RINGS = contourRings()

/**
 * The login screen's one bold element: topographic contour lines around a
 * summit, which also reads as a drop-zone target seen from above. The single
 * orange dot is the only accent. Decorative (hidden from assistive tech) and
 * static; sized by its container (it slices to fill, never letterboxes). Styled
 * with presentation attributes and `--lb-*` tokens, so it carries no CSS of its own.
 */
export function ContourArt() {
  return (
    <svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {RINGS.map((ring, index) => (
        <path
          key={index}
          d={ring.d}
          className={ring.major ? 'contour-art__ring contour-art__ring--major' : 'contour-art__ring'}
          fill="none"
          stroke="var(--lb-contour)"
          strokeWidth={ring.major ? 2 : 1.1}
          strokeOpacity={ring.major ? 1 : 0.7}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <circle
        cx="200"
        cy="200"
        r="11"
        fill="none"
        stroke="var(--lb-accent)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle className="contour-art__summit" cx="200" cy="200" r="4.5" fill="var(--lb-accent)" />
    </svg>
  )
}
