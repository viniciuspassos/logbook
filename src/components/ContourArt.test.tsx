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

  it('is static: no animation, so nothing to switch off for reduced motion', () => {
    const { container } = render(<ContourArt />)
    expect(container.querySelector('[style]')).toBeNull()
  })

  it('marks the summit with the accent dot', () => {
    const { container } = render(<ContourArt />)
    expect(container.querySelector('.contour-art__summit')).toBeInTheDocument()
  })
})
