/**
 * Geometry for the login screen's topographic illustration (ContourArt): a
 * set of irregular, concentric closed curves around one summit, drawn in a
 * 400x400 box. Computed rather than hand-written so the count and spacing are
 * one knob, and deterministic (no randomness) so the art is identical on every
 * render and in every test.
 */

export interface ContourRing {
  /** SVG path data for one closed contour line. */
  d: string
  /** Every fourth line, drawn heavier like an index contour on a map. */
  major: boolean
}

const CENTER = 200
const POINTS = 16
const FIRST_RADIUS = 26
const RADIUS_STEP = 25
const DEFAULT_RING_COUNT = 8

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** One ring's outline points: a wobbly circle whose wobble and drift grow outward. */
function ringPoints(index: number): Array<[number, number]> {
  const radius = FIRST_RADIUS + index * RADIUS_STEP
  const phase = index * 0.55
  // The summit leans up and to the right, so outer rings drift off-centre.
  const cx = CENTER + index * 3.2
  const cy = CENTER - index * 2.4
  const points: Array<[number, number]> = []
  for (let i = 0; i < POINTS; i++) {
    const angle = (i / POINTS) * Math.PI * 2
    const wobble =
      1 +
      0.11 * Math.sin(2 * angle + phase) +
      0.06 * Math.sin(3 * angle + phase * 1.7) +
      0.03 * Math.sin(5 * angle + phase * 2.3)
    points.push([cx + radius * 1.15 * wobble * Math.cos(angle), cy + radius * wobble * Math.sin(angle)])
  }
  return points
}

/** Closed path through the points' midpoints, with the points as control points. */
function smoothClosedPath(points: Array<[number, number]>): string {
  const mid = (a: [number, number], b: [number, number]) => `${round((a[0] + b[0]) / 2)} ${round((a[1] + b[1]) / 2)}`
  const last = points.length - 1
  const segments = points.map((p, i) => `Q${round(p[0])} ${round(p[1])} ${mid(p, points[(i + 1) % points.length])}`)
  return `M${mid(points[last], points[0])}${segments.join('')}Z`
}

/** `count` contour rings, innermost first. */
export function contourRings(count: number = DEFAULT_RING_COUNT): ContourRing[] {
  return Array.from({ length: count }, (_, index) => ({
    d: smoothClosedPath(ringPoints(index)),
    major: index % 4 === 0,
  }))
}
