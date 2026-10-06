import { contourRings } from './contourPaths.ts'

describe('contourRings', () => {
  it('returns the requested number of closed smooth paths', () => {
    const rings = contourRings(9)
    expect(rings).toHaveLength(9)
    for (const ring of rings) {
      expect(ring.d).toMatch(/^M[\d.\s-]+(Q[\d.\s-]+)+Z$/)
    }
  })

  it('defaults to a full set of rings', () => {
    expect(contourRings().length).toBeGreaterThanOrEqual(8)
  })

  it('is deterministic, so the art never shifts between renders', () => {
    expect(contourRings(6)).toEqual(contourRings(6))
  })

  it('gives every ring its own outline', () => {
    const outlines = new Set(contourRings(9).map((ring) => ring.d))
    expect(outlines.size).toBe(9)
  })

  it('marks every fourth ring as an index contour, like a topographic map', () => {
    const major = contourRings(9).map((ring) => ring.major)
    expect(major).toEqual([true, false, false, false, true, false, false, false, true])
  })

  it('returns no rings for a count of zero', () => {
    expect(contourRings(0)).toEqual([])
  })
})
