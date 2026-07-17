import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttachmentGallery } from './AttachmentGallery.tsx'

describe('AttachmentGallery', () => {
  it('renders a thumbnail for each attachment', () => {
    render(
      <AttachmentGallery
        attachments={[
          { key: 'server-1', url: '/api/attachments/1/file', pending: false },
          { key: 'pending-2', url: 'blob:local', pending: true },
        ]}
        busy={false}
        status={null}
        onAddPhoto={() => {}}
      />,
    )
    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute('src', '/api/attachments/1/file')
  })

  it('marks a pending (not-yet-uploaded) attachment as such', () => {
    render(
      <AttachmentGallery
        attachments={[{ key: 'pending-2', url: 'blob:local', pending: true }]}
        busy={false}
        status={null}
        onAddPhoto={() => {}}
      />,
    )
    expect(screen.getByText('Uploading…')).toBeInTheDocument()
  })

  it('renders no thumbnails when there are no attachments', () => {
    render(<AttachmentGallery attachments={[]} busy={false} status={null} onAddPhoto={() => {}} />)
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('calls onAddPhoto with the selected file', async () => {
    const onAddPhoto = jest.fn()
    const user = userEvent.setup()
    render(<AttachmentGallery attachments={[]} busy={false} status={null} onAddPhoto={onAddPhoto} />)

    const file = new File(['bytes'], 'summit.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Add photo'), file)

    expect(onAddPhoto).toHaveBeenCalledWith(file)
  })

  it('disables the add-photo input while busy', () => {
    render(<AttachmentGallery attachments={[]} busy={true} status={null} onAddPhoto={() => {}} />)
    expect(screen.getByLabelText('Add photo')).toBeDisabled()
  })

  it('announces status via an aria-live region', () => {
    render(
      <AttachmentGallery
        attachments={[]}
        busy={false}
        status={{ tone: 'info', message: 'Photo uploaded.' }}
        onAddPhoto={() => {}}
      />,
    )
    expect(screen.getByRole('status', { name: 'Attachment status' })).toHaveTextContent('Photo uploaded.')
  })

  it('renders no status text when status is absent', () => {
    render(<AttachmentGallery attachments={[]} busy={false} status={null} onAddPhoto={() => {}} />)
    expect(screen.getByRole('status', { name: 'Attachment status' })).toHaveTextContent('')
  })

  it('styles an error status distinctly from an info status', () => {
    render(
      <AttachmentGallery
        attachments={[]}
        busy={false}
        status={{ tone: 'error', message: 'Too large.' }}
        onAddPhoto={() => {}}
      />,
    )
    const status = screen.getByRole('status', { name: 'Attachment status' })
    expect(status.querySelector('.attachment-gallery__status-text--error')).toBeInTheDocument()
  })
})
