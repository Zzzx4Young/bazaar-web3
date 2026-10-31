import { expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MediaCarousel } from '@/components/listing/media-carousel'

it('shows a readable placeholder when listing media fails to load', () => {
  render(
    <MediaCarousel media={[{ type: 'image', url: '/broken.png', alt: 'Cover' }]} alt="Listing" />
  )
  fireEvent.error(screen.getByRole('img', { name: 'Cover' }))
  expect(screen.getByText('noImage')).toBeInTheDocument()
})

it('uses the same fallback for a failed thumbnail', () => {
  render(
    <MediaCarousel
      media={[
        { type: 'image', url: '/broken.png', alt: 'Broken cover' },
        { type: 'image', url: '/other.png', alt: 'Other cover' }
      ]}
      alt="Listing"
    />
  )
  fireEvent.error(screen.getAllByRole('img', { name: 'Broken cover' })[0]!)
  expect(screen.getAllByText('noImage')).toHaveLength(2)
})
