import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountSettings, type AccountSettingsProps } from './AccountSettings.tsx'

function makeProps(overrides: Partial<AccountSettingsProps> = {}): AccountSettingsProps {
  return {
    profile: { id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace', picture: null },
    pending: false,
    status: null,
    onLogout: jest.fn(),
    ...overrides,
  }
}

describe('AccountSettings', () => {
  it('shows the account name and e-mail', () => {
    render(<AccountSettings {...makeProps()} />)
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
  })

  it('falls back to the e-mail alone when the account has no name', () => {
    render(<AccountSettings {...makeProps({ profile: { id: 1, email: 'ada@example.com', name: null, picture: null } })} />)
    expect(screen.getAllByText('ada@example.com')).toHaveLength(1)
  })

  it('shows a plain "Signed in" row when the profile is not known', () => {
    render(<AccountSettings {...makeProps({ profile: null })} />)
    expect(screen.getByText('Signed in')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('shows the Google picture, with empty alt text since the name sits beside it', () => {
    const { container } = render(
      <AccountSettings
        {...makeProps({ profile: { id: 1, email: 'a@b.co', name: 'Ada', picture: 'https://example.com/a.png' } })}
      />,
    )
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://example.com/a.png')
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('falls back to the initial when the picture cannot load (offline)', () => {
    const { container } = render(
      <AccountSettings
        {...makeProps({ profile: { id: 1, email: 'a@b.co', name: 'Ada', picture: 'https://example.com/a.png' } })}
      />,
    )

    fireEvent.error(container.querySelector('img') as HTMLImageElement)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('shows the initial when there is no picture', () => {
    render(<AccountSettings {...makeProps()} />)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('has no password field', () => {
    render(<AccountSettings {...makeProps()} />)
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('calls onLogout when Sign out is clicked', async () => {
    const user = userEvent.setup()
    const onLogout = jest.fn()
    render(<AccountSettings {...makeProps({ onLogout })} />)

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('disables Sign out while pending', () => {
    render(<AccountSettings {...makeProps({ pending: true })} />)
    expect(screen.getByRole('button', { name: /sign out/i })).toBeDisabled()
  })

  it('resets the picture fallback when the account or its picture changes', () => {
    const withPicture = { id: 1, email: 'a@b.co', name: 'Ada', picture: 'https://example.com/a.png' }
    const { container, rerender } = render(<AccountSettings {...makeProps({ profile: withPicture })} />)
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()

    rerender(<AccountSettings {...makeProps({ profile: { ...withPicture, picture: 'https://example.com/b.png' } })} />)

    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/b.png')
  })

  it('announces sign-out progress or errors politely', () => {
    const { container, rerender } = render(<AccountSettings {...makeProps({ status: 'Signing out…' })} />)
    const region = container.querySelector('.account-settings__status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveTextContent('Signing out…')

    rerender(<AccountSettings {...makeProps({ status: null })} />)
    expect(container.querySelector('.account-settings__status')).toBeEmptyDOMElement()
  })

  it('warns, next to Sign out, that signing out removes this device\'s entries but keeps them on the server', () => {
    render(<AccountSettings {...makeProps()} />)
    expect(screen.getByText("Signing out removes this device's entries (they stay on the server).")).toBeInTheDocument()
  })
})
