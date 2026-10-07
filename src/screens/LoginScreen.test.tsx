import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginScreen, type LoginScreenProps } from './LoginScreen.tsx'
import { renderGoogleSignInButton, type GoogleButtonResult } from '../lib/auth/googleIdentity.ts'

jest.mock('../lib/auth/googleIdentity.ts', () => ({
  renderGoogleSignInButton: jest.fn(),
}))

const renderMock = renderGoogleSignInButton as jest.Mock

function makeProps(overrides: Partial<LoginScreenProps> = {}): LoginScreenProps {
  return {
    pending: false,
    error: null,
    clientId: 'cid.apps.googleusercontent.com',
    onCredential: jest.fn(),
    ...overrides,
  }
}

async function renderScreen(props: LoginScreenProps = makeProps()) {
  const view = render(<LoginScreen {...props} />)
  await act(async () => {})
  return view
}

function resolveWith(result: GoogleButtonResult) {
  renderMock.mockResolvedValue(result)
}

beforeEach(() => {
  jest.clearAllMocks()
  resolveWith({ status: 'rendered' })
})

describe('LoginScreen', () => {
  it('names the app and says what it is for, in plain words', async () => {
    await renderScreen()
    expect(screen.getByRole('heading', { level: 1, name: 'Logbook' })).toBeInTheDocument()
    expect(screen.getByText('Record climbs and jumps, even with no signal.')).toBeInTheDocument()
    expect(screen.getByText(/opens offline/i)).toBeInTheDocument()
  })

  it('renders the decorative contour art, hidden from assistive tech', async () => {
    const { container } = await renderScreen()
    expect(container.querySelector('.login__art svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders Google\'s button into its slot and shows no error', async () => {
    const { container } = await renderScreen()
    const slot = container.querySelector('.login__google')
    expect(renderMock).toHaveBeenCalledWith(slot, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(slot).not.toHaveAttribute('hidden')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('forwards the ID token from Google to onCredential', async () => {
    const onCredential = jest.fn()
    await renderScreen(makeProps({ onCredential }))

    renderMock.mock.calls[0][1].onCredential('id-token')

    expect(onCredential).toHaveBeenCalledWith('id-token')
  })

  it('aborts the pending Google load when it unmounts', async () => {
    const { unmount } = await renderScreen()
    const signal = renderMock.mock.calls[0][1].signal as AbortSignal

    unmount()

    expect(signal.aborted).toBe(true)
  })

  it('ignores a cancelled render (e.g. the StrictMode remount)', async () => {
    resolveWith({ status: 'cancelled' })
    const { container } = await renderScreen()
    expect(container.querySelector('.login__google')).not.toHaveAttribute('hidden')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('announces that sign-in is in progress, politely, and dims the button', async () => {
    const { container } = await renderScreen(makeProps({ pending: true }))
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('Signing in…')
    expect(container.querySelector('.login__google')).toHaveClass('is-pending')
  })

  it('shows a sign-in error from the server in the live region', async () => {
    await renderScreen(makeProps({ error: "This Google account isn't allowed to use this Logbook." }))
    expect(screen.getByRole('status')).toHaveTextContent("This Google account isn't allowed to use this Logbook.")
  })

  it('says it cannot reach Google when offline, and offers a retry', async () => {
    resolveWith({ status: 'unavailable', reason: 'offline' })
    const { container } = await renderScreen()

    expect(screen.getByRole('status')).toHaveTextContent("Couldn't reach Google. Check your connection and try again.")
    expect(container.querySelector('.login__google')).toHaveAttribute('hidden')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('retries loading Google when "Try again" is pressed', async () => {
    const user = userEvent.setup()
    resolveWith({ status: 'unavailable', reason: 'offline' })
    await renderScreen()
    expect(renderMock).toHaveBeenCalledTimes(1)

    resolveWith({ status: 'rendered' })
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(renderMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('explains a missing client ID without offering a pointless retry', async () => {
    resolveWith({ status: 'unavailable', reason: 'no-client-id' })
    await renderScreen()

    expect(screen.getByRole('status')).toHaveTextContent("Sign-in isn't set up for this Logbook yet.")
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('treats an empty error as no error, so Google\'s own status still shows', async () => {
    resolveWith({ status: 'unavailable', reason: 'offline' })
    await renderScreen(makeProps({ error: '' }))
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't reach Google. Check your connection and try again.")
  })

  it('prefers the server error over the offline hint', async () => {
    resolveWith({ status: 'unavailable', reason: 'offline' })
    await renderScreen(makeProps({ error: 'Sign-in expired. Try again.' }))
    expect(screen.getByRole('status')).toHaveTextContent('Sign-in expired. Try again.')
  })

  it('keeps the button when the parent passes a new callback mid sign-in, but uses the latest one', async () => {
    const first = jest.fn()
    const second = jest.fn()
    const { rerender } = await renderScreen(makeProps({ onCredential: first }))

    rerender(<LoginScreen {...makeProps({ onCredential: second })} />)
    await act(async () => {})

    expect(renderMock).toHaveBeenCalledTimes(1)
    renderMock.mock.calls[0][1].onCredential('id-token')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('id-token')
  })

  it('removes the rendered button from its slot on unmount', async () => {
    const { container, unmount } = await renderScreen()
    const slot = container.querySelector('.login__google') as HTMLElement
    slot.appendChild(document.createElement('iframe'))

    unmount()

    expect(slot.childElementCount).toBe(0)
  })

  it('un-hides the slot before measuring and rendering on a retry', async () => {
    const user = userEvent.setup()
    resolveWith({ status: 'unavailable', reason: 'offline' })
    const { container } = await renderScreen()
    const hiddenAtRender: boolean[] = []
    renderMock.mockImplementation(async (slot: HTMLElement) => {
      hiddenAtRender.push(slot.hasAttribute('hidden'))
      return { status: 'rendered' }
    })

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(hiddenAtRender).toEqual([false])
    expect(container.querySelector('.login__google')).not.toHaveAttribute('hidden')
  })

  describe('over the running app', () => {
    it('offers "Not now" only when it can be dismissed', async () => {
      const user = userEvent.setup()
      const onDismiss = jest.fn()
      const { unmount } = await renderScreen(makeProps({ onDismiss }))

      await user.click(screen.getByRole('button', { name: 'Not now' }))
      expect(onDismiss).toHaveBeenCalledTimes(1)

      unmount()
      await renderScreen()
      expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument()
    })
  })

  it('hands the client ID the server gave to the Google button', async () => {
    await renderScreen(makeProps({ clientId: 'server.apps.googleusercontent.com' }))
    expect(renderMock.mock.calls[0][1].clientId).toBe('server.apps.googleusercontent.com')
  })

  it('renders the button again only if the client ID changes', async () => {
    const props = makeProps()
    const { rerender } = await renderScreen(props)
    rerender(<LoginScreen {...props} />)
    await act(async () => {})
    expect(renderMock).toHaveBeenCalledTimes(1)

    rerender(<LoginScreen {...props} clientId="other.apps.googleusercontent.com" />)
    await act(async () => {})
    expect(renderMock).toHaveBeenCalledTimes(2)
  })

  it('passes no client ID through as null, and says sign-in is not set up', async () => {
    resolveWith({ status: 'unavailable', reason: 'no-client-id' })
    await renderScreen(makeProps({ clientId: null }))
    expect(renderMock.mock.calls[0][1].clientId).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent("Sign-in isn't set up for this Logbook yet.")
  })
})
