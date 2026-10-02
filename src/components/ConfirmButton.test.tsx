import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { ConfirmButton } from './ConfirmButton.tsx'

function renderButton(props: Partial<ComponentProps<typeof ConfirmButton>> = {}) {
  const onConfirm = jest.fn()
  render(<ConfirmButton label="Delete entry" confirmLabel="Delete" onConfirm={onConfirm} {...props} />)
  return { onConfirm, user: userEvent.setup() }
}

describe('ConfirmButton', () => {
  it('does not act on the first click, only asks for confirmation', async () => {
    const { onConfirm, user } = renderButton()

    await user.click(screen.getByRole('button', { name: 'Delete entry' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Delete entry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
  })

  it('calls onConfirm once the confirmation is clicked', async () => {
    const { onConfirm, user } = renderButton()

    await user.click(screen.getByRole('button', { name: 'Delete entry' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Delete entry' })).toBeInTheDocument()
  })

  it('backs out without acting when cancelled', async () => {
    const { onConfirm, user } = renderButton({ cancelLabel: 'Keep' })

    await user.click(screen.getByRole('button', { name: 'Delete entry' }))
    await user.click(screen.getByRole('button', { name: 'Keep' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete entry' })).toHaveFocus()
  })

  it('backs out on Escape', async () => {
    const { onConfirm, user } = renderButton()

    await user.click(screen.getByRole('button', { name: 'Delete entry' }))
    await user.keyboard('{Escape}')

    expect(onConfirm).not.toHaveBeenCalled()
    // Keyboard and screen-reader users land back where they started.
    expect(screen.getByRole('button', { name: 'Delete entry' })).toHaveFocus()
  })

  it('ignores other keys while armed', async () => {
    const { onConfirm, user } = renderButton()

    await user.click(screen.getByRole('button', { name: 'Delete entry' }))
    await user.keyboard('a')

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Delete entry' })).toBeInTheDocument()
  })

  it('shows custom visible content while keeping the label as its accessible name', () => {
    renderButton({ children: '×' })
    expect(screen.getByRole('button', { name: 'Delete entry' })).toHaveTextContent('×')
  })

  it('cannot be armed while disabled', () => {
    renderButton({ disabled: true })
    expect(screen.getByRole('button', { name: 'Delete entry' })).toBeDisabled()
  })
})
