import type { AdventureShape } from '../types/entry.ts'

/**
 * Whether a shape belongs to the "parachute/skydiving" adventure family
 * rather than the "mountain" one (climbing/trekking) — every seed entry with
 * `shape: 'circle'` has `activityType: 'Skydiving'`, while `'triangle'` and
 * `'diamond'` are climbing/trekking, so `shape` alone (the reliable 3-value
 * enum) is enough to branch, without depending on the free-text
 * `activityType` field. Used to pick the desktop ink-stamp color
 * (AdventureBadge.tsx/.css).
 */
export function isSkydivingShape(shape: AdventureShape): boolean {
  return shape === 'circle'
}
