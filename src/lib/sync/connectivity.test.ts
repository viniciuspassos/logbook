import { onBackOnline } from './connectivity.ts'

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

afterEach(() => setVisibility('visible'))

describe('onBackOnline', () => {
  it('calls the listener when the browser comes back online', () => {
    const listener = jest.fn()
    const stop = onBackOnline(listener)

    window.dispatchEvent(new Event('online'))

    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('also calls it when the window regains focus', () => {
    const listener = jest.fn()
    const stop = onBackOnline(listener)

    window.dispatchEvent(new Event('focus'))

    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('also calls it when the tab becomes visible, but not when it is hidden', () => {
    const listener = jest.fn()
    const stop = onBackOnline(listener)

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(listener).not.toHaveBeenCalled()

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stops listening to all three after the returned cleanup', () => {
    const listener = jest.fn()
    onBackOnline(listener)()

    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))

    expect(listener).not.toHaveBeenCalled()
  })
})
