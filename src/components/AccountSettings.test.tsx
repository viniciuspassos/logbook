import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountSettings, type AccountSettingsProps } from './AccountSettings.tsx'

function makeProps(overrides: Partial<AccountSettingsProps> = {}): AccountSettingsProps {
  return {
    state: 'unknown' as const,
    pending: false,
    error: null,
    onLogin: jest.fn().mockResolvedValue(true),
    onLogout: jest.fn(),
    ...overrides,
  }
}

describe('AccountSettings', () => {
  it('shows a password field and a sign-in button when not signed in (unknown)', () => {
    render(<AccountSettings {...makeProps({ state: 'unknown' })} />)
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('announces the sign-in/signed-in state transition politely, not just the error text', () => {
    // The whole container carries aria-live so a screen reader hears the
    // form -> "Signed in" swap once login settles, not just error messages.
    const { container } = render(<AccountSettings {...makeProps({ state: 'unknown' })} />)
    expect(container.querySelector('.account-settings')).toHaveAttribute('aria-live', 'polite')
  })

  it('shows the same sign-in form when explicitly signed out', () => {
    render(<AccountSettings {...makeProps({ state: 'signedOut' })} />)
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('shows a signed-in row with a sign-out button when signed in', () => {
    render(<AccountSettings {...makeProps({ state: 'signedIn' })} />)
    expect(screen.getByText(/signed in/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('submits the entered password via onLogin', async () => {
    const user = userEvent.setup()
    const onLogin = jest.fn().mockResolvedValue(true)
    render(<AccountSettings {...makeProps({ onLogin })} />)

    await user.type(screen.getByLabelText(/password/i), 'hunter2')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(onLogin).toHaveBeenCalledWith('hunter2')
  })

  it('clears the password field after a successful sign-in', async () => {
    const user = userEvent.setup()
    const onLogin = jest.fn().mockResolvedValue(true)
    render(<AccountSettings {...makeProps({ onLogin })} />)

    const input = screen.getByLabelText(/password/i) as HTMLInputElement
    await user.type(input, 'hunter2')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(input.value).toBe('')
  })

  it('keeps the entered password after a failed sign-in so the user can correct it', async () => {
    const user = userEvent.setup()
    const onLogin = jest.fn().mockResolvedValue(false)
    render(<AccountSettings {...makeProps({ onLogin })} />)

    const input = screen.getByLabelText(/password/i) as HTMLInputElement
    await user.type(input, 'wrong')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(input.value).toBe('wrong')
  })

  it('does not submit an empty password', async () => {
    const user = userEvent.setup()
    const onLogin = jest.fn().mockResolvedValue(true)
    render(<AccountSettings {...makeProps({ onLogin })} />)

    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(onLogin).not.toHaveBeenCalled()
  })

  it('disables the sign-in button while pending', () => {
    render(<AccountSettings {...makeProps({ state: 'unknown', pending: true })} />)
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled()
  })

  it('disables the sign-out button while pending', () => {
    render(<AccountSettings {...makeProps({ state: 'signedIn', pending: true })} />)
    expect(screen.getByRole('button', { name: /sign out/i })).toBeDisabled()
  })

  it('calls onLogout when the sign-out button is clicked', async () => {
    const user = userEvent.setup()
    const onLogout = jest.fn()
    render(<AccountSettings {...makeProps({ state: 'signedIn', onLogout })} />)

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('announces a sign-in error politely', () => {
    render(<AccountSettings {...makeProps({ error: 'Incorrect password.' })} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Incorrect password.')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })

  it('renders no status region at all when there is no error', () => {
    // Deliberately absent (not just empty) so it never collides with another
    // `role="status"` region rendered alongside it — see SettingsScreen,
    // which pairs this with its own export-status region.
    render(<AccountSettings {...makeProps({ error: null })} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
