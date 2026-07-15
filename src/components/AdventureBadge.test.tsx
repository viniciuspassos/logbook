import { render, screen } from '@testing-library/react'
import { AdventureBadge } from './AdventureBadge.tsx'

describe('AdventureBadge', () => {
  it('renders the glyph for the given shape', () => {
    render(<AdventureBadge shape="diamond" />)
    expect(screen.getByTestId('shape-glyph-diamond')).toBeInTheDocument()
  })

  it('sizes the badge box and scales the glyph with it', () => {
    render(<AdventureBadge shape="circle" size={44} />)
    const glyph = screen.getByTestId('shape-glyph-circle')
    expect(glyph.style.width).toBe('17.6px')
  })
})
