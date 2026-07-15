import { render, screen } from '@testing-library/react'
import { ShapeGlyph } from './ShapeGlyph.tsx'

describe('ShapeGlyph', () => {
  it('renders a clip-path triangle', () => {
    render(<ShapeGlyph shape="triangle" />)
    const el = screen.getByTestId('shape-glyph-triangle')
    expect(el.style.clipPath).toContain('polygon')
  })

  it('renders a rounded circle', () => {
    render(<ShapeGlyph shape="circle" />)
    const el = screen.getByTestId('shape-glyph-circle')
    expect(el.style.borderRadius).toBe('50%')
  })

  it('renders a rotated diamond', () => {
    render(<ShapeGlyph shape="diamond" />)
    const el = screen.getByTestId('shape-glyph-diamond')
    expect(el.style.transform).toBe('rotate(45deg)')
  })

  it('sizes the glyph from the size prop', () => {
    render(<ShapeGlyph shape="circle" size={20} />)
    const el = screen.getByTestId('shape-glyph-circle')
    expect(el.style.width).toBe('20px')
    expect(el.style.height).toBe('20px')
  })
})
