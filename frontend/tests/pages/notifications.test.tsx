import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import NotificationsPage from '@/app/[locale]/notifications/page'

describe('NotificationsPage Alpha boundary', () => {
  it('states that notifications are unavailable without rendering fake activity', () => {
    render(<NotificationsPage />)
    expect(screen.getByRole('heading', { name: 'Alpha 暂未开放通知服务' })).toBeInTheDocument()
    expect(screen.getByText(/不会展示虚构通知/)).toBeInTheDocument()
    expect(screen.queryByText('订单已确认')).not.toBeInTheDocument()
  })
})
