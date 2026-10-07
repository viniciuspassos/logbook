/**
 * @jest-environment node
 */
import { onBackOnline } from './connectivity.ts'

describe('onBackOnline without a window', () => {
  it('returns a no-op cleanup instead of throwing', () => {
    const stop = onBackOnline(jest.fn())
    expect(() => stop()).not.toThrow()
  })
})
