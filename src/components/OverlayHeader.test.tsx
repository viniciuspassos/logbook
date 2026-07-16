import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OverlayHeader } from './OverlayHeader.tsx'

describe('OverlayHeader', () => {
  it('renders the label and back chevron', () => {
    render(<OverlayHeader label="Back" onBack={() => {}} />)
    expect(screen.getByText('Back')).toBeInTheDocument()
    expect(screen.getByText('‹')).toBeInTheDocument()
  })

  it('calls onBack when the chevron is clicked', async () => {
    const onBack = jest.fn()
    const user = userEvent.setup()
    render(<OverlayHeader label="Cancel" onBack={onBack} />)
    await user.click(screen.getByText('‹'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
