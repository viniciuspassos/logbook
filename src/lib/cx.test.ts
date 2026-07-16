import { cx } from './cx.ts'

describe('cx', () => {
  it('joins truthy fragments with single spaces', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c')
  })

  it('drops falsy fragments', () => {
    expect(cx('base', false, null, undefined, 'active')).toBe('base active')
  })

  it('supports conditional active classes', () => {
    const isActive = true
    expect(cx('tab', isActive && 'is-active')).toBe('tab is-active')
    expect(cx('tab', !isActive && 'is-active')).toBe('tab')
  })

  it('returns an empty string when nothing is truthy', () => {
    expect(cx(false, null, undefined)).toBe('')
  })
})
