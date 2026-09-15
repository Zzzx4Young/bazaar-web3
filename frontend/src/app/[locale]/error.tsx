'use client'

export default function Error({
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div role="alert" className="mx-auto max-w-xl space-y-4 rounded-md border p-6">
      <h1 className="text-lg font-semibold">页面暂时无法加载</h1>
      <p className="text-sm text-muted-foreground">
        请重试；如果问题持续，请提供页面上的 Request ID。
      </p>
      <button
        type="button"
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        onClick={reset}
      >
        重试
      </button>
    </div>
  )
}
