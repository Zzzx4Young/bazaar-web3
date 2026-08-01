import { Bell } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Link } from '@/i18n/routing'
import { mockNotifications } from '@/mock/notifications'
import { formatDate } from '@/lib/format'
import type { Notification, NotificationKind } from '@/types'

const KIND_ICON: Record<NotificationKind, string> = {
  order: '📦',
  favorite: '❤️',
  system: 'ℹ️'
}

export default function NotificationsPage() {
  const all: Notification[] = mockNotifications as Notification[]
  const unreadCount = all.filter(n => !n.read).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          通知{' '}
          {unreadCount > 0 && (
            <Badge variant="destructive" className="ml-1 align-middle">
              {unreadCount}
            </Badge>
          )}
        </h1>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" disabled title="mock — no real action">
            全部标为已读
          </Button>
        )}
      </div>

      {all.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-12 text-center text-sm text-muted-foreground">
            <Bell className="h-10 w-10 opacity-30" />
            <p>没有新通知</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {all.map(n => (
            <li
              key={n.id}
              data-unread={!n.read ? 'true' : undefined}
              className={`rounded-lg border bg-card p-4 transition ${
                !n.read ? 'border-primary/50 bg-primary/5' : ''
              }`}
            >
              {n.href ? (
                <Link href={n.href} className="block">
                  <NotificationBody n={n} />
                </Link>
              ) : (
                <NotificationBody n={n} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NotificationBody({ n }: { n: Notification }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-2xl" aria-hidden>
        {KIND_ICON[n.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`text-sm ${!n.read ? 'font-semibold' : 'font-normal'}`}>
            {n.title}
          </span>
          {!n.read && (
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" aria-label="未读" />
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {formatDate(n.createdAt)}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
      </div>
    </div>
  )
}