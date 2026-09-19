import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Pagination } from '@/components/explore/pagination'

describe('Pagination', () => {
  it('renders page context and emits the next page', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={2} pageSize={12} total={30} onPageChange={onPageChange} />)

    expect(screen.getByText('第 2 / 3 页')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('disables navigation at both boundaries', () => {
    render(<Pagination page={1} pageSize={12} total={12} onPageChange={() => {}} />)
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })
})
