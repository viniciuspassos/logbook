import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignInBanner } from './SignInBanner.tsx'

describe('SignInBanner', () => {
  it('shows its message as a polite live region', () => {
    render(<SignInBanner message="Sign in again to resume syncing." onSignIn={jest.fn()} onDismiss={jest.fn()} />)
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('Sign in again to resume syncing.')
    expect(region).toHaveAttribute('aria-live', 'polite')
  })

  it('calls onSignIn when the button is pressed', async () => {
    const user = userEvent.setup()
    const onSignIn = jest.fn()
    render(<SignInBanner message="m" onSignIn={onSignIn} onDismiss={jest.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it('can be dismissed with "Not now"', async () => {
    const user = userEvent.setup()
    const onDismiss = jest.fn()
    render(<SignInBanner message="m" onSignIn={jest.fn()} onDismiss={onDismiss} />)

    await user.click(screen.getByRole('button', { name: 'Not now' }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('works as a plain notice: no sign-in button, and a custom dismiss label', async () => {
    const user = userEvent.setup()
    const onDismiss = jest.fn()
    render(<SignInBanner message="Entries removed." dismissLabel="OK" onDismiss={onDismiss} />)

    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'OK' }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
