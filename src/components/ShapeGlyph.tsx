import type { CSSProperties } from 'react'
import type { AdventureShape } from '../types/entry.ts'

interface ShapeGlyphProps {
  shape: AdventureShape
  size?: number
}

/** The small triangle/circle/diamond marker used to distinguish adventure types. */
export function ShapeGlyph({ shape, size = 9 }: ShapeGlyphProps) {
  const style: CSSProperties = {
    width: size,
    height: size,
    background: 'currentColor',
    flexShrink: 0,
  }
  if (shape === 'triangle') {
    style.clipPath = 'polygon(50% 0%, 0% 100%, 100% 100%)'
  } else if (shape === 'circle') {
    style.borderRadius = '50%'
  } else {
    style.transform = 'rotate(45deg)'
  }
  return <div data-testid={`shape-glyph-${shape}`} aria-hidden="true" style={style} />
}
