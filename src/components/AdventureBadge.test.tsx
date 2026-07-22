import { render, screen } from '@testing-library/react'
import { AdventureBadge } from './AdventureBadge.tsx'

describe('AdventureBadge', () => {
  it('renders the glyph for the given shape', () => {
    render(<AdventureBadge shape="diamond" />)
    expect(screen.getByTestId('shape-glyph-diamond')).toBeInTheDocument()
  })

  it('scales the glyph to 40% of the fixed badge size', () => {
    render(<AdventureBadge shape="circle" />)
    const glyph = screen.getByTestId('shape-glyph-circle')
    // 22px badge * 0.4 = 8.8px glyph.
    expect(glyph.style.width).toBe('8.8px')
  })

  it('adds the desktop ink-stamp "parachute" modifier class for a circle shape', () => {
    render(<AdventureBadge shape="circle" />)
    expect(screen.getByTestId('shape-glyph-circle').parentElement).toHaveClass(
      'adventure-badge--parachute',
    )
  })

  it.each(['triangle', 'diamond'] as const)(
    'omits the "parachute" modifier class for a %s (mountain-type) shape',
    (shape) => {
      render(<AdventureBadge shape={shape} />)
      expect(screen.getByTestId(`shape-glyph-${shape}`).parentElement).not.toHaveClass(
        'adventure-badge--parachute',
      )
    },
  )
})
