import { onBackOnline } from './connectivity.ts'

describe('onBackOnline', () => {
  it('calls the listener when the browser comes back online', () => {
    const listener = jest.fn()
    const stop = onBackOnline(listener)

    window.dispatchEvent(new Event('online'))

    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stops listening after the returned cleanup', () => {
    const listener = jest.fn()
    onBackOnline(listener)()

    window.dispatchEvent(new Event('online'))

    expect(listener).not.toHaveBeenCalled()
  })
})
