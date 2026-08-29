import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Heart } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

describe('EmptyState', () => {
  it('renders title, description, and the default Inbox icon', () => {
    const { container } = render(
      <EmptyState title="No items" description="Try a different filter" />
    )
    expect(screen.getByText('No items')).toBeInTheDocument()
    expect(screen.getByText('Try a different filter')).toBeInTheDocument()
    // default icon: lucide Inbox → has aria-hidden
    const svg = container.querySelector('svg[aria-hidden="true"]')
    expect(svg).toBeTruthy()
    // data-testid marks the wrapper for stable hook in pages
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
  })

  it('accepts a custom icon', () => {
    render(<EmptyState icon={Heart} title="Nothing here" />)
    // any svg from the custom Heart icon
    expect(document.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('renders action node below the text', () => {
    render(
      <EmptyState
        title="Empty"
        action={<a href="/browse">go</a>}
      />
    )
    const link = screen.getByRole('link', { name: /go/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/browse')
  })

  it('omits description when not provided', () => {
    const { container } = render(<EmptyState title="Just a title" />)
    expect(screen.getByText('Just a title')).toBeInTheDocument()
    // description paragraph should not exist
    expect(container.querySelector('p')).toBeNull()
  })

  it('flat variant does not wrap in a card', () => {
    const { container } = render(
      <EmptyState title="x" variant="flat" />
    )
    // the wrapper div is the testid itself, not a bordered card surface
    const wrapper = screen.getByTestId('empty-state')
    expect(wrapper).toBeInTheDocument()
    expect(container.querySelector('.border-dashed')).toBeNull()
  })
})
