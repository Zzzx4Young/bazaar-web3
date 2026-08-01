import { PublishForm } from '@/components/publish/publish-form'

export default function PublishPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">发布商品</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          填写商品信息，发布后立即出现在首页推荐位。所有交易在 Sepolia 测试网模拟，0 真实资金。
        </p>
      </div>
      <PublishForm />
    </div>
  )
}