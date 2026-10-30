import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Pagination } from '@/components/explore/pagination'
import en from '../../messages/en.json'
import zhCN from '../../messages/zh-CN.json'

describe('Pagination', () => {
  it('has complete labels in both supported locales', () => {
    expect(en.explore.pagination).toEqual({
      label: 'Product pages',
      previous: 'Previous page',
      next: 'Next page',
      pageStatus: 'Page {page} of {pageCount}'
    })
    expect(zhCN.explore.pagination).toEqual({
      label: '商品分页',
      previous: '上一页',
      next: '下一页',
      pageStatus: '第 {page} / {pageCount} 页'
    })
  })
  it('renders page context and emits the next page', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={2} pageSize={12} total={30} onPageChange={onPageChange} />)

    expect(screen.getByText('pageStatus')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'next' }))
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('disables navigation at both boundaries', () => {
    render(<Pagination page={1} pageSize={12} total={12} onPageChange={() => {}} />)
    expect(screen.getByRole('navigation', { name: 'label' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'next' })).toBeDisabled()
  })
})
