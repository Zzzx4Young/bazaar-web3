import { BellOff } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">通知</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <BellOff className="h-10 w-10 text-muted-foreground" aria-hidden />
          <h2 className="font-semibold">Alpha 暂未开放通知服务</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            当前订单状态请在“我的”页面查看。这里不会展示虚构通知或未落库的未读数量。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
