# Frontend 技术选型表 — Next.js + shadcn/ui（推荐）

> **状态**：v0.1 推荐稿，等用户拍板 Q3（Next.js 已默认）+ Q4（shadcn/ui 推荐）
> **生成日期**：2026-07-31
> **关联**：[frontend-prototype-roadmap.md §3](./frontend-prototype-roadmap.md) / [mock-data-spec.md](./mock-data-spec.md)

---

## 0. 选型摘要

| 维度 | 选型 | 版本 | 备注 |
|---|---|---|---|
| **框架** | Next.js | `^14.2.0` | App Router（默认） |
| **UI 库** | React | `^18.3.0` | Next.js 14 兼容上限 |
| **样式** | Tailwind CSS | `^3.4.0` | shadcn/ui 强制依赖 |
| **UI 组件** | shadcn/ui | latest（手动 copy） | 按需复制源码 |
| **图标** | lucide-react | `^0.400.0` | shadcn/ui 默认 |
| **状态管理** | Zustand | `^4.5.0` | 轻量 + TS 友好 |
| **表单** | React Hook Form | `^7.51.0` | shadcn/ui 标配 |
| **表单校验** | Zod | `^3.23.0` | 与 RHF 配合 |
| **HTTP mock** | MSW (Mock Service Worker) | `^2.3.0` | API Routes 拦截 |
| **Markdown 渲染** | react-markdown + remark-gfm | `^9.0.0` + `^4.0.0` | 详情页描述 |
| **轮播** | embla-carousel-react | `^8.0.0` | 详情页图集 |
| **日期** | dayjs | `^1.11.0` | 体积小，3KB |
| **类名合并** | clsx + tailwind-merge | `^2.1.0` + `^2.2.0` | shadcn 标配 |
| **TS** | TypeScript | `^5.4.0` | 严格模式 |

**故意不引入**：

- ❌ **Wagmi / Viem / WalletConnect** —— 真钱包不在本路线。响应式兼容即可。
- ❌ **TanStack Query** —— 全 mock 数据，Zustand 够用
- ❌ **next-intl** —— i18n 推迟到 Phase 2
- ❌ **next-auth** —— 无后端认证
- ❌ **framer-motion** —— 简单 transition 用 Tailwind 过渡即可

---

## 1. 目录结构草案

```
crypto-c2c/frontend/
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json              # shadcn/ui 配置
├── .eslintrc.json
├── .prettierrc
├── .gitignore
├── README.md
├── public/
│   └── (空)
└── src/
    ├── app/
    │   ├── layout.tsx           # 根布局 + 顶部 nav
    │   ├── page.tsx             # 首页 /
    │   ├── explore/
    │   │   └── page.tsx         # /explore
    │   ├── listing/
    │   │   └── [id]/
    │   │       └── page.tsx     # /listing/[id]
    │   ├── publish/
    │   │   └── page.tsx         # /publish
    │   ├── me/
    │   │   ├── page.tsx         # /me
    │   │   └── orders/
    │   │       └── page.tsx     # /me/orders
    │   ├── api/                 # API Routes（mock 走这里）
    │   │   ├── items/
    │   │   │   └── route.ts
    │   │   ├── orders/
    │   │   │   └── route.ts
    │   │   └── favorites/
    │   │       └── route.ts
    │   └── globals.css          # Tailwind 入口 + shadcn 变量
    ├── components/
    │   ├── ui/                  # shadcn/ui 复制的组件源码
    │   │   ├── button.tsx
    │   │   ├── card.tsx
    │   │   ├── dialog.tsx
    │   │   ├── sheet.tsx
    │   │   ├── tabs.tsx
    │   │   ├── form.tsx
    │   │   ├── input.tsx
    │   │   ├── select.tsx
    │   │   ├── slider.tsx
    │   │   ├── badge.tsx
    │   │   ├── avatar.tsx
    │   │   ├── skeleton.tsx
    │   │   └── sonner.tsx       # toast
    │   ├── layout/
    │   │   ├── TopNav.tsx
    │   │   ├── BottomTabBar.tsx # 移动端
    │   │   └── Footer.tsx
    │   ├── home/
    │   │   ├── HeroBanner.tsx   # 轮播
    │   │   ├── CategoryTabs.tsx
    │   │   └── ItemGrid.tsx
    │   ├── listing/
    │   │   ├── ItemCard.tsx
    │   │   ├── FilterSidebar.tsx
    │   │   ├── MediaCarousel.tsx
    │   │   ├── SellerCard.tsx
    │   │   ├── MarkdownRenderer.tsx
    │   │   ├── BuyModal.tsx     # 模拟
    │   │   └── ChatDrawer.tsx   # 模拟
    │   ├── publish/
    │   │   ├── PublishForm.tsx
    │   │   ├── UploadDropzone.tsx
    │   │   └── DigitalDeliveryForm.tsx
    │   └── me/
    │       ├── ProfileHeader.tsx
    │       └── OrderTable.tsx
    ├── lib/
    │   ├── utils.ts             # shadcn cn() helper
    │   ├── format.ts            # 价格 / 日期格式化
    │   └── filter.ts            # 列表筛选纯函数
    ├── stores/
    │   ├── useItemStore.ts      # 商品（mock + user-published）
    │   ├── useFilterStore.ts    # 筛选状态
    │   ├── useOrderStore.ts     # 订单（localStorage）
    │   ├── useUserStore.ts      # 当前用户（写死 alice）
    │   └── useFavoriteStore.ts  # 收藏
    ├── types/
    │   ├── item.ts              # Item / ItemCategory / ItemStatus
    │   ├── seller.ts
    │   ├── order.ts
    │   ├── category.ts
    │   └── user.ts
    ├── mock/
    │   ├── items.json           # 25 条
    │   ├── sellers.json         # 6 个
    │   ├── orders.json          # 12 条
    │   ├── banners.json         # 5 个
    │   └── categories.json      # 5 个一级 + 子类
    └── hooks/
        ├── useLocalStorage.ts
        └── useMediaQuery.ts     # 响应式断点
```

---

## 2. Next.js 配置要点

### `next.config.mjs`

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'placehold.co' },
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: 'api.dicebear.com' }
    ]
  },
  reactStrictMode: true
}
export default nextConfig
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### `tailwind.config.ts`

```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        // ... shadcn 默认
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
}
export default config
```

---

## 3. 响应式断点（Tailwind 默认）

| 断点 | 宽度 | 用途 |
|---|---|---|
| (默认) | < 640px | Web3 钱包内置浏览器 / 移动 H5 |
| `sm:` | ≥ 640px | 大屏手机 / 小平板 |
| `md:` | ≥ 768px | 平板 |
| `lg:` | ≥ 1024px | 小桌面 |
| `xl:` | ≥ 1280px | 桌面 |
| `2xl:` | ≥ 1536px | 大桌面 |

**布局策略**：
- `< sm`：单列 + 底部 TabBar
- `sm ~ md`：双列网格
- `≥ md`：三列网格 + 顶部 nav

---

## 4. SEO 基础

每个页面 `generateMetadata`：

```ts
// app/listing/[id]/page.tsx
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = await getItem(params.id)
  return {
    title: `${item.title} · CryptoC2C`,
    description: item.description.slice(0, 160),
    openGraph: {
      title: item.title,
      description: item.description.slice(0, 160),
      images: item.media[0]?.url
    }
  }
}
```

`app/layout.tsx` 设置 `metadataBase` + 默认 OG image。

---

## 5. 待决策 / 风险

| 风险 | 缓解 |
|---|---|
| shadcn/ui 复制源码版本与官方不同步 | 锁定 commit hash 在 README |
| Next.js 14 SSR + `localStorage` 不兼容 | 所有 localStorage 读取放 `useEffect` 内 |
| MSW + Next.js App Router 集成复杂 | 改用纯 Zustand + JSON import（更简单） |
| placehold.co 偶尔 503 | 备选 picsum.photos；CI 检查连通性 |

---

## 6. 与 Q1 / Q3 / Q4 关系

- **Q3**：本选型表假设 Next.js（用户已默认 Next.js / React）
- **Q4**：本选型表假设 shadcn/ui（推荐稿，待用户确认）
- **Q1**：本选型表**不依赖** Q1 答案 —— 无论 A/B/C，目录结构与依赖列表都成立

---

## 7. 下一步

按 [frontend-prototype-roadmap.md §7](./frontend-prototype-roadmap.md)：

1. 等用户确认 **Q4**（shadcn/ui / Ant Design）+ **Q1**（spec 处置）
2. 拍板后**生成 `frontend/` 目录 + `package.json` + 配置文件**（不安装依赖）
3. 二次确认后**执行 `pnpm install` + 跑 `pnpm dev` 验证脚手架可启动**