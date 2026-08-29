import { type LucideIcon, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  /** Optional CTA button(s) rendered below the text. */
  action?: ReactNode
  /** Visual style. `card` (default) wraps in a bordered surface; `flat` is flush. */
  variant?: 'card' | 'flat'
}

/**
 * Shared empty-state placeholder for favorites, search-no-results, no-orders,
 * no-listings, etc. Always pairs a lucide icon with a one-line title and an
 * optional CTA — never just raw text.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  variant = 'card'
}: EmptyStateProps) {
  const inner = (
    <>
      <div className="empty-halo relative mx-auto flex h-20 w-20 items-center justify-center rounded-full">
        <div className="absolute inset-2 rounded-full bg-background" />
        <Icon className="relative h-9 w-9 text-primary" aria-hidden />
      </div>
      <h3 className="mt-5 text-base font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </>
  )

  if (variant === 'flat') {
    return (
      <div className="flex flex-col items-center py-10 text-center" data-testid="empty-state">
        {inner}
      </div>
    )
  }

  return (
    <div
      className="rounded-xl border border-dashed bg-card px-6 py-12 text-center"
      data-testid="empty-state"
    >
      {inner}
    </div>
  )
}
