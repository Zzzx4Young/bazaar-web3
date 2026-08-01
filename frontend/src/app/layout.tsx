import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CryptoC2C — 加密货币支付的 C2C 二手交易平台',
  description:
    '面向海外加密社区的 C2C 二手交易平台，支持 USDT / ETH 链上 escrow。原型 demo 版本。',
  metadataBase: new URL('http://localhost:3000'),
  openGraph: {
    title: 'CryptoC2C',
    description: '加密货币支付的 C2C 二手交易平台',
    type: 'website'
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <header className="border-b">
          <div className="container flex h-14 items-center justify-between">
            <div className="font-semibold">CryptoC2C</div>
            <nav className="flex gap-4 text-sm">
              <a href="/" className="hover:underline">
                首页
              </a>
              <a href="/explore" className="hover:underline">
                探索
              </a>
              <a href="/publish" className="hover:underline">
                发布
              </a>
              <a href="/me" className="hover:underline">
                我的
              </a>
            </nav>
          </div>
        </header>
        <main className="container py-6">{children}</main>
        <footer className="border-t py-6 text-center text-xs text-muted-foreground">
          CryptoC2C · 原型 demo · Sepolia 测试网 · 0 真实资金
        </footer>
      </body>
    </html>
  )
}