import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatDrawer } from '@/components/listing/chat-drawer'
import type { Seller } from '@/types'

const baseSeller: Seller = {
  id: 'seller_001',
  displayName: 'mobile_zone',
  avatarSeed: 'mobile',
  joinedAt: '2024-01-01T00:00:00Z',
  completedOrders: 100,
  rating: 4.8,
  ratingCount: 90,
  activeItemIds: []
}

describe('ChatDrawer — initial state', () => {
  it('renders nothing when seller is null', () => {
    const { container } = render(<ChatDrawer seller={null} open={true} onOpenChange={() => {}} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('shows welcome message when opened', async () => {
    render(<ChatDrawer seller={baseSeller} open={true} onOpenChange={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText(/你好！我是 mobile_zone/)).toBeInTheDocument()
    })
  })

  it('shows seller display name in header', async () => {
    render(<ChatDrawer seller={baseSeller} open={true} onOpenChange={() => {}} />)
    expect(screen.getAllByText('mobile_zone').length).toBeGreaterThan(0)
  })

  it('shows "在线" status indicator', async () => {
    render(<ChatDrawer seller={baseSeller} open={true} onOpenChange={() => {}} />)
    expect(screen.getByText('在线')).toBeInTheDocument()
  })
})

describe('ChatDrawer — sending messages', () => {
  it('send button is disabled when input is empty', () => {
    render(<ChatDrawer seller={baseSeller} open={true} onOpenChange={() => {}} />)
    const sendButton = screen.getByRole('button', { name: '' }) // Send icon button
    expect(sendButton).toBeDisabled()
  })

  it('typing in input enables send button', async () => {
    const user = userEvent.setup()
    render(<ChatDrawer seller={baseSeller} open={true} onOpenChange={() => {}} />)

    const input = screen.getByPlaceholderText('输入消息...')
    await user.type(input, '你好')

    // The send button is the only button without text; find by being the parent of the Send icon
    const buttons = screen.getAllByRole('button')
    const sendButton = buttons.find(b => b.querySelector('svg'))
    expect(sendButton).not.toBeDisabled()
  })

  it('clicking send appends message and clears input', async () => {
    const user = userEvent.setup()
    render(<ChatDrawer seller={baseSeller} open={true} onOpenChange={() => {}} />)

    const input = screen.getByPlaceholderText('输入消息...')
    await user.type(input, '在吗')

    const buttons = screen.getAllByRole('button')
    const sendButton = buttons.find(b => b.querySelector('svg'))!
    await user.click(sendButton)

    expect(screen.getByText('在吗')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('Enter key submits message', async () => {
    const user = userEvent.setup()
    render(<ChatDrawer seller={baseSeller} open={true} onOpenChange={() => {}} />)

    const input = screen.getByPlaceholderText('输入消息...')
    await user.type(input, '你好{Enter}')

    expect(screen.getByText('你好')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('whitespace-only messages are not sent', async () => {
    const user = userEvent.setup()
    render(<ChatDrawer seller={baseSeller} open={true} onOpenChange={() => {}} />)

    const input = screen.getByPlaceholderText('输入消息...')
    await user.type(input, '   ')

    const buttons = screen.getAllByRole('button')
    const sendButton = buttons.find(b => b.querySelector('svg'))!
    expect(sendButton).toBeDisabled()
  })
})

describe('ChatDrawer — auto-reply', () => {
  it('after sending a message, seller auto-replies', async () => {
    const user = userEvent.setup()
    render(<ChatDrawer seller={baseSeller} open={true} onOpenChange={() => {}} />)

    const input = screen.getByPlaceholderText('输入消息...')
    await user.type(input, 'test message')

    const buttons = screen.getAllByRole('button')
    const sendButton = buttons.find(b => b.querySelector('svg'))!
    await user.click(sendButton)

    await waitFor(
      () => {
        expect(screen.getByText(/收到！我看一下/)).toBeInTheDocument()
      },
      { timeout: 3000 }
    )
  })

  it('welcome message and user message both present after send', async () => {
    const user = userEvent.setup()
    render(<ChatDrawer seller={baseSeller} open={true} onOpenChange={() => {}} />)

    // wait for welcome
    await waitFor(() => screen.getByText(/你好！我是/))

    const input = screen.getByPlaceholderText('输入消息...')
    await user.type(input, '问个问题{Enter}')

    expect(screen.getByText('问个问题')).toBeInTheDocument()
    expect(screen.getByText(/你好！我是/)).toBeInTheDocument()
  })
})