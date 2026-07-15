import { render, screen } from '@testing-library/react'
import { PhotoPlaceholder } from './PhotoPlaceholder.tsx'

describe('PhotoPlaceholder', () => {
  it('exposes the hint as an accessible label', () => {
    render(<PhotoPlaceholder hint="summit shot" />)
    expect(screen.getByRole('img', { name: 'summit shot' })).toBeInTheDocument()
    expect(screen.getByText('summit shot')).toBeInTheDocument()
  })

  it('applies a full circle radius for the circle shape', () => {
    render(<PhotoPlaceholder hint="avatar" shape="circle" />)
    expect(screen.getByRole('img', { name: 'avatar' }).style.borderRadius).toBe('50%')
  })

  it('applies the given radius for the rounded shape', () => {
    render(<PhotoPlaceholder hint="thumb" shape="rounded" radius={14} />)
    expect(screen.getByRole('img', { name: 'thumb' }).style.borderRadius).toBe('14px')
  })

  it('applies no radius for the rect shape', () => {
    render(<PhotoPlaceholder hint="map" shape="rect" />)
    expect(screen.getByRole('img', { name: 'map' }).style.borderRadius).toBe('')
  })
})
