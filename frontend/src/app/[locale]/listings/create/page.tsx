import { PublishForm } from '@/components/publish/publish-form'

export default function CreateListingPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">发布商品</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          商品及数字授权元数据将写入 Alpha 服务端；私有交付链接在订单付款后单独提交。
        </p>
      </div>
      <PublishForm />
    </div>
  )
}
