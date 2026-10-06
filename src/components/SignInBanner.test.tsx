import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignInBanner } from './SignInBanner.tsx'

describe('SignInBanner', () => {
  it('says syncing is paused and how to resume it, as a polite live region', () => {
    render(<SignInBanner onSignIn={jest.fn()} />)
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('Sign in again to resume syncing.')
    expect(region).toHaveAttribute('aria-live', 'polite')
  })

  it('calls onSignIn when the button is pressed', async () => {
    const user = userEvent.setup()
    const onSignIn = jest.fn()
    render(<SignInBanner onSignIn={onSignIn} />)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(onSignIn).toHaveBeenCalledTimes(1)
  })
})
