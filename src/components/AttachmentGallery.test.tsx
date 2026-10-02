import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttachmentGallery } from './AttachmentGallery.tsx'

describe('AttachmentGallery', () => {
  it('renders a thumbnail for each attachment', () => {
    render(
      <AttachmentGallery
        attachments={[
          { key: 'server-1', url: '/api/attachments/1/file', pending: false, attachmentId: 1 },
          { key: 'pending-2', url: 'blob:local', pending: true, queueId: 2 },
        ]}
        busy={false}
        status={null}
        onAddPhoto={() => {}}
        onRemovePhoto={() => {}}
      />,
    )
    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute('src', '/api/attachments/1/file')
  })

  it('marks a pending (not-yet-uploaded) attachment as such', () => {
    render(
      <AttachmentGallery
        attachments={[{ key: 'pending-2', url: 'blob:local', pending: true, queueId: 2 }]}
        busy={false}
        status={null}
        onAddPhoto={() => {}}
        onRemovePhoto={() => {}}
      />,
    )
    expect(screen.getByText('Uploading…')).toBeInTheDocument()
  })

  it('marks a server-rejected photo with its reason instead of "Uploading…"', () => {
    render(
      <AttachmentGallery
        attachments={[
          { key: 'pending-5', url: 'blob:local', pending: false, queueId: 5, rejectedReason: 'File too large' },
        ]}
        busy={false}
        status={null}
        onAddPhoto={() => {}}
      />,
    )
    expect(screen.queryByText('Uploading…')).not.toBeInTheDocument()
    expect(screen.getByText('Rejected: File too large')).toBeInTheDocument()
    expect(screen.getByAltText('Photo attachment, rejected by the server')).toBeInTheDocument()
  })

  it('discards a rejected photo by its queueId', async () => {
    const onDiscardPhoto = jest.fn()
    const user = userEvent.setup()
    render(
      <AttachmentGallery
        attachments={[
          { key: 'pending-5', url: 'blob:local', pending: false, queueId: 5, rejectedReason: 'File too large' },
          { key: 'server-1', url: '/api/attachments/1/file', pending: false },
        ]}
        busy={false}
        status={null}
        onAddPhoto={() => {}}
        onDiscardPhoto={onDiscardPhoto}
      />,
    )

    const remove = screen.getAllByRole('button', { name: 'Remove rejected photo' })
    expect(remove).toHaveLength(1)
    await user.click(remove[0])

    expect(onDiscardPhoto).toHaveBeenCalledWith(5)
  })

  it('offers no Remove button when there is no discard handler to call', () => {
    render(
      <AttachmentGallery
        attachments={[
          { key: 'pending-5', url: '', pending: false, queueId: 5, rejectedReason: 'File too large' },
        ]}
        busy={false}
        status={null}
        onAddPhoto={() => {}}
      />,
    )
    expect(screen.getByText('Rejected: File too large')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove rejected photo' })).not.toBeInTheDocument()
  })

  it('renders no thumbnails when there are no attachments', () => {
    render(<AttachmentGallery attachments={[]} busy={false} status={null} onAddPhoto={() => {}} onRemovePhoto={() => {}} />)
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('calls onAddPhoto with the selected file', async () => {
    const onAddPhoto = jest.fn()
    const user = userEvent.setup()
    render(<AttachmentGallery attachments={[]} busy={false} status={null} onAddPhoto={onAddPhoto} onRemovePhoto={() => {}} />)

    const file = new File(['bytes'], 'summit.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Add photo'), file)

    expect(onAddPhoto).toHaveBeenCalledWith(file)
  })

  it('disables the add-photo input while busy', () => {
    render(<AttachmentGallery attachments={[]} busy={true} status={null} onAddPhoto={() => {}} onRemovePhoto={() => {}} />)
    expect(screen.getByLabelText('Add photo')).toBeDisabled()
  })

  it('announces status via an aria-live region', () => {
    render(
      <AttachmentGallery
        attachments={[]}
        busy={false}
        status={{ tone: 'info', message: 'Photo uploaded.' }}
        onAddPhoto={() => {}}
        onRemovePhoto={() => {}}
      />,
    )
    expect(screen.getByRole('status', { name: 'Attachment status' })).toHaveTextContent('Photo uploaded.')
  })

  it('renders no status text when status is absent', () => {
    render(<AttachmentGallery attachments={[]} busy={false} status={null} onAddPhoto={() => {}} onRemovePhoto={() => {}} />)
    expect(screen.getByRole('status', { name: 'Attachment status' })).toHaveTextContent('')
  })

  it('styles an error status distinctly from an info status', () => {
    render(
      <AttachmentGallery
        attachments={[]}
        busy={false}
        status={{ tone: 'error', message: 'Too large.' }}
        onAddPhoto={() => {}}
        onRemovePhoto={() => {}}
      />,
    )
    const status = screen.getByRole('status', { name: 'Attachment status' })
    expect(status.querySelector('.attachment-gallery__status-text--error')).toBeInTheDocument()
  })

  describe('removing a photo', () => {
    const photos = [
      { key: 'server-1', url: '/api/attachments/1/file', pending: false, attachmentId: 1 },
      { key: 'pending-2', url: 'blob:local', pending: true, queueId: 2 },
    ] as const

    it('removes only the chosen photo, after confirming', async () => {
      const onRemovePhoto = jest.fn()
      const user = userEvent.setup()
      render(
        <AttachmentGallery
          attachments={[...photos]}
          busy={false}
          status={null}
          onAddPhoto={() => {}}
          onRemovePhoto={onRemovePhoto}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Remove photo 2' }))
      expect(onRemovePhoto).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'Remove' }))

      expect(onRemovePhoto).toHaveBeenCalledTimes(1)
      expect(onRemovePhoto).toHaveBeenCalledWith(photos[1])
    })

    it('keeps the photo when the removal is cancelled', async () => {
      const onRemovePhoto = jest.fn()
      const user = userEvent.setup()
      render(
        <AttachmentGallery
          attachments={[...photos]}
          busy={false}
          status={null}
          onAddPhoto={() => {}}
          onRemovePhoto={onRemovePhoto}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
      await user.click(screen.getByRole('button', { name: 'Keep' }))

      expect(onRemovePhoto).not.toHaveBeenCalled()
    })

    it('disables removal while another photo action is in flight', () => {
      render(
        <AttachmentGallery
          attachments={[...photos]}
          busy={true}
          status={null}
          onAddPhoto={() => {}}
          onRemovePhoto={() => {}}
        />,
      )
      expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeDisabled()
    })
  })
})
