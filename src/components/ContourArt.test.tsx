import { render } from '@testing-library/react'
import { ContourArt } from './ContourArt.tsx'

describe('ContourArt', () => {
  it('is decorative: hidden from assistive technology', () => {
    const { container } = render(<ContourArt />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
  })

  it('draws the contour rings, with some marked as index contours', () => {
    const { container } = render(<ContourArt />)
    expect(container.querySelectorAll('.contour-art__ring').length).toBeGreaterThanOrEqual(8)
    expect(container.querySelectorAll('.contour-art__ring--major').length).toBeGreaterThan(0)
  })

  it('staggers each ring through its --ring index', () => {
    const { container } = render(<ContourArt />)
    const rings = container.querySelectorAll<SVGPathElement>('.contour-art__ring')
    expect(rings[0].style.getPropertyValue('--ring')).toBe('0')
    expect(rings[3].style.getPropertyValue('--ring')).toBe('3')
  })

  it('marks the summit with the accent dot', () => {
    const { container } = render(<ContourArt />)
    expect(container.querySelector('.contour-art__summit')).toBeInTheDocument()
  })
})
