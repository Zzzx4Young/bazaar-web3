import { Link } from '@/i18n/routing'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/stores/use-auth-store'

export function ProfileHeader() {
  const account = useAuthStore((state) => state.view?.account)
  if (!account) return null
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
        <Avatar className="h-16 w-16 shrink-0">
          <AvatarFallback>{account.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{account.displayName}</h1>
            <Badge variant="outline">Alpha 账户</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">登录名：{account.loginName}</p>
        </div>
        <Link
          href="/publish"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          发布商品
        </Link>
      </CardContent>
    </Card>
  )
}
