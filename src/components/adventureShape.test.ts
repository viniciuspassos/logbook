import { isSkydivingShape } from './adventureShape.ts'

describe('isSkydivingShape', () => {
  it('is true for circle', () => {
    expect(isSkydivingShape('circle')).toBe(true)
  })

  it.each(['triangle', 'diamond'] as const)('is false for %s', (shape) => {
    expect(isSkydivingShape(shape)).toBe(false)
  })
})
