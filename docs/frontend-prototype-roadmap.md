# Frontend Prototype Roadmap — 纯前端先行路线

> **状态**：v0.1 草稿，待用户回答 §7 三个 Q 才能进入实施阶段。
> **生成日期**：2026-07-31
> **来源**：用户 standing goal"阶段目标：构建 C2C 交易平台基础展示与交互原型"完整落档
> **关联文档**：[mvp-spec.md](./mvp-spec.md)（带链上 escrow 的真后端路线）/ [mvp-tickets.md](./mvp-tickets.md) / [problem.md](./problem.md) / [00-project-flow.md](./00-project-flow.md)
> **本路线不动现有 mvp-spec.md / mvp-tickets.md / problem.md**——直到 §7 Q1 拍板。

---

## 0. 摘要

**目标**：在 0 后端 / 0 合约 / 0 真钱包连接的前提下，先把 C2C 二手交易平台的**前端 UI + 交互 + Mock 数据**完整跑通，作为产品演示、设计验证、和后续接真后端的过渡产物。

**范围**（用户给定）：
- ✅ 前端框架（Next.js / Nuxt 二选一）
- ✅ UI 组件库（shadcn / Ant Design 二选一）
- ✅ 数据 schema 定义（Item / Categories）
- ✅ 5 个核心页面（首页 / 列表 / 详情 / 发布 / 个人中心）
- ✅ Mock 数据集（20-30 条实物 + 数字物品）
- ✅ localStorage 模拟发布流程
- ✅ 响应式（移动端 H5 / Web3 钱包内置浏览器 + PC 端）

**不在本路线范围**：
- ❌ 真后端 API（Fastify / Postgres / S3）—— 后续阶段
- ❌ 真链上 escrow 合约 —— 后续阶段
- ❌ 真 WalletConnect 钱包登录 —— 仅 UI 兼容（响应式）
- ❌ 真支付流程 —— 模拟 modal
- ❌ KYC / 信用分 / 评价 / 物流 —— 不在 standing goal 4 阶段里

---

## 1. 阶段目标（用户 standing goal 原文）

### 第一阶段：技术栈 + 脚手架

- 前端框架：Next.js (React) 或 Nuxt.js (Vue) —— SSR 利于 SEO，内置 API Routes 模拟后端
- UI 组件库：Tailwind CSS + shadcn/ui 或 Ant Design
- 状态管理 / Mock：Zustand / Redux Toolkit + Mock.js / 本地 JSON
- **交付物**：可运行的前端空白项目，配置好路由与基础样式库

### 第二阶段：数据结构设计（Schema Design）

**核心数据类型 Item / Resource**：
- ID、标题、描述
- 分类（实物 / 数字物品）
- 标签（99新、源码、账号等）
- 价格（标价 ETH / USDT）、原价
- 资源类型（实物-快递/面交 / 数字-下载链接/卡密/密钥）
- 媒体文件（图片、视频、数字资源缩略图）
- 卖家信息（头像、昵称、信用评级/历史成交数）
- 状态（在售 / 已被锁定 / 已售出）

**分类与筛选 Categories & Filters**：
- 一级分类：电子数码 / 数字资产 / 软件源码 / 游戏道具 / 二手服饰
- 筛选属性：价格区间 / 物品新旧度 / 交易链/币种 / 发布时间

### 第三阶段：核心展示页面

| # | 页面 | 关键功能 |
|---|---|---|
| 1 | 首页 `/` | 搜索栏、分类导航、轮播 banner、商品瀑布流 |
| 2 | 列表页 `/explore` | 多维度筛选、分页/无限加载 |
| 3 | 详情页 `/listing/[id]` | 媒体轮播、价格、卖家卡片、Markdown 描述、模拟购买 modal、模拟聊天框、收藏/分享 |
| 4 | 发布页 `/publish` | 实物/数字切换、上传拖拽、价格/链/代币设置、数字发货方式 |
| 5 | 个人中心 `/me` | 公开主页、订单管理（买到/卖出两栏）、评价 |

### 第四阶段：交互 + Mock 数据联动

- Mock 数据集 20-30 条（二手手机、潮鞋、域名、游戏CG、源码脚本）
- 前端纯 JS 搜索/筛选实时联动
- 发布表单提交 → localStorage / Zustand → 自动跳转详情页或首页
- 响应式：移动端 H5 / Web3 钱包内置浏览器 / PC 端

---

## 2. 与 mvp-spec.md 的差异（关键决策点）

| 维度 | mvp-spec.md（缩减版 A） | 本路线（纯前端原型） |
|---|---|---|
| 后端 | Fastify + Postgres + S3 | 无，纯前端 |
| 合约 | Solidity Escrow + Sepolia | 无 |
| 钱包 | WalletConnect 必接 | 仅 UI 兼容（响应式） |
| 支付 | 链上 USDT escrow | 模拟 modal |
| 资金安全 | Gnosis Safe 多签 | 不涉及 |
| 数据 | DB（链上 source of truth） | localStorage + Mock JSON |
| 团队 | 2 人 × 14 周（已划 20 ticket） | 估 2 人 × 3-5 周（估，待精算） |
| 目标 | 真跑通订单 | UI 原型 / 投资人演示 / 设计验证 |
| KYC | 邮箱验证 | 不涉及 |
| 部署 | Vercel + VPS + Sepolia | Vercel 单前端 |

**两份文档关系**（待 Q1 拍板）：
- 若 Q1=A（作废旧 spec）：本路线是 v2，旧 spec 移进 archive
- 若 Q1=B（保留旧 spec）：本路线是"前端 demo"，旧 spec 是"产品终局"
- 若 Q1=C（并存）：两份都是有效文档，团队按上下文选读

---

## 3. 阶段一：技术栈选型

### Q3：Next.js vs Nuxt.js（待拍板）

| 维度 | Next.js | Nuxt.js |
|---|---|---|
| 生态 | React 生态更广 | Vue 生态在国内更稳 |
| Web3 | wagmi/viem 都是 React-first | Vue 适配要绕一层 |
| SSR | App Router (RSC) | Nuxt 3 |
| SEO | 都原生支持 | 都原生支持 |
| 招人 | React 容易 | Vue 国内容易 |
| 跟 mvp-spec 衔接 | mvp-spec §4.3 已定 Next.js 14 | 推翻 spec |

**我的建议**：Next.js。理由：跟 mvp-spec §4.3 一致，未来切回真后端不用换栈；wagmi / viem / walletconnect 全是 React-first，Vue 要绕。

### Q4：shadcn/ui vs Ant Design（待拍板）

| 维度 | shadcn/ui | Ant Design |
|---|---|---|
| 风格 | 极简、web3 圈标配 | 中后台风 |
| 体积 | 按需复制源码 | 全量包 |
| 学习曲线 | 需 Tailwind | 组件 API 标准化 |
| C2C 平台调性 | **更像闲鱼 / 加密原生** | **更像淘宝 / 后台** |

**我的建议**：shadcn/ui。理由：C2C + 加密 = 简洁风更对路；按需复制源码 = bundle 小，响应式 H5 友好。

### 其他选型（建议默认）

| 组件 | 建议 | 理由 |
|---|---|---|
| 状态管理 | Zustand | 比 Redux Toolkit 轻，TS 友好，本路线 Mock 场景足够 |
| Mock 数据 | 本地 JSON + MSW（Mock Service Worker） | API Routes 用 MSW 拦截，未来切真后端零改动 |
| 样式 | Tailwind CSS | shadcn/ui 强制依赖 |
| 表单 | React Hook Form + Zod | shadcn/ui 标配 |
| 路由 | Next.js App Router（内置） | Next.js 14 默认 |
| 国际化 | next-intl | 后续真后端接海外用户需要 |
| 图片 | next/image + 公共 CDN 占位 | 不接 S3 |

---

## 4. 阶段二：数据 Schema 草案

> **本节是 schema 草案**，不动 mvp-spec.md。Q1 拍板后再决定是否合并。

### 4.1 Item（商品 / 资源）

```ts
type ItemCategory = 'physical' | 'digital'  // 实物 / 数字
type ItemStatus = 'active' | 'locked' | 'sold'
type ItemCondition = 'new' | 'like_new' | 'good' | 'fair' | 'poor'  // 实物成色
type DigitalDeliveryType = 'download_link' | 'license_key' | 'cloud_link' | 'account_credentials'

interface Item {
  id: string                          // UUID
  sellerId: string
  title: string
  description: string                 // Markdown
  category: ItemCategory
  tags: string[]                      // ['99新', '源码', '账号']
  price: {
    amount: number                    // 数字
    currency: 'ETH' | 'USDT' | 'SOL'
    fiatEstimate?: number             // 法币折算（如 USD），前端计算
  }
  originalPrice?: {                   // 原价（划线价）
    amount: number
    currency: 'ETH' | 'USDT' | 'SOL'
  }
  // 实物字段
  condition?: ItemCondition           // 仅 category=physical
  shippingMethod?: 'delivery' | 'face_to_face'  // 仅 physical
  // 数字字段
  deliveryType?: DigitalDeliveryType  // 仅 category=digital
  // 媒体
  media: Array<{
    type: 'image' | 'video' | 'thumbnail'
    url: string                       // 占位图 / 公共 CDN
    alt?: string
  }>
  // 数字交付物预览（仅 category=digital，发布页填写的卡密/链接预览，但不暴露给买家）
  deliveryPreview?: string            // 仅 seller 看，UI 提示"已设置"
  // 元信息
  status: ItemStatus
  viewCount: number
  favoriteCount: number
  createdAt: string                   // ISO
  updatedAt: string
}
```

### 4.2 Seller（卖家公开信息）

```ts
interface Seller {
  id: string
  displayName: string
  avatarUrl: string
  joinedAt: string                    // ISO
  // 信用相关（mock 写死）
  completedOrders: number             // 历史成交数
  rating: number                      // 1-5 星（mock）
  ratingCount: number
  // 公开商品
  activeItemIds: string[]
}
```

### 4.3 Order（mock 订单，不上链）

```ts
type OrderStatus =
  | 'pending_payment'      // 待付款
  | 'pending_fulfillment'  // 待发货（实物）/ 待交付（数字）
  | 'pending_confirm'      // 待确认收货（实物）
  | 'completed'            // 已完成
  | 'cancelled'            // 已取消

interface Order {
  id: string
  itemId: string
  buyerId: string
  sellerId: string
  amount: { amount: number; currency: 'ETH' | 'USDT' | 'SOL' }
  status: OrderStatus
  createdAt: string
  // 角色
  role: 'buyer' | 'seller'             // 个人中心用此过滤
}
```

### 4.4 Categories & Filters

```ts
type PrimaryCategory =
  | 'electronics'      // 电子数码
  | 'digital_assets'   // 数字资产
  | 'software_source'  // 软件源码
  | 'game_items'       // 游戏道具
  | 'secondhand_fashion' // 二手服饰

interface Category {
  id: PrimaryCategory
  label: string                        // 中英文
  icon: string                         // lucide-react icon name
  subcategories?: string[]             // 二级分类占位
}

interface FilterState {
  category?: PrimaryCategory
  itemCategory?: ItemCategory         // 实物/数字 二选一
  priceMin?: number
  priceMax?: number
  currency?: 'ETH' | 'USDT' | 'SOL'
  condition?: ItemCondition            // 仅实物
  sortBy: 'newest' | 'price_asc' | 'price_desc' | 'popular'
  page: number
  pageSize: number
}
```

### 4.5 User（mock 用户）

```ts
interface User {
  id: string
  displayName: string
  avatarUrl: string
  walletAddress?: string               // mock 一个 0x 开头的字符串
  joinedAt: string
}
```

---

## 5. 阶段三：核心页面清单

### 5.1 路由表（Next.js App Router）

| 路由 | 页面 | 关键组件 | 数据来源 |
|---|---|---|---|
| `/` | 首页 | `<HeroBanner>` `<CategoryTabs>` `<ItemGrid>` | Mock JSON + localStorage |
| `/explore` | 列表/筛选页 | `<FilterSidebar>` `<ItemGrid>` `<LoadMore>` | 同上 |
| `/listing/[id]` | 详情页 | `<MediaCarousel>` `<PricePanel>` `<SellerCard>` `<MarkdownDescription>` `<BuyModal>` `<ChatDrawer>` | 单条 mock |
| `/publish` | 发布页 | `<CategoryToggle>` `<UploadDropzone>` `<PriceInput>` `<DigitalDeliveryForm>` | 表单 → localStorage |
| `/me` | 个人中心 | `<ProfileHeader>` `<Tabs>` `<ItemGrid>` | 当前 mock user |
| `/me/orders?role=buyer\|seller` | 订单列表 | `<OrderTable>` | localStorage |

### 5.2 关键组件清单（shadcn/ui）

- `Button` / `Card` / `Badge` / `Avatar` / `Dialog` / `Sheet` / `Tabs` / `Form` / `Input` / `Select` / `Slider` / `Skeleton` / `Toast` —— shadcn/ui 标配
- `MediaCarousel` —— 图片/视频轮播（用 embla-carousel-react）
- `ItemCard` —— 商品卡（图、标题、价格、卖家）
- `FilterSidebar` —— 侧边筛选
- `MarkdownRenderer` —— react-markdown + remark-gfm
- `ChatDrawer` —— 模拟聊天框（Sheet 组件）

---

## 6. 阶段四：Mock 数据策略

### 6.1 Mock 数据来源

**静态部分**（`/mock/items.json`）：20-30 条商品，6 大类均匀分布。

| 大类 | 条数 | 示例 |
|---|---:|---|
| 电子数码（physical） | 5 | iPhone 15 Pro 99新 / Sony WH-1000XM5 / MacBook Air M2 |
| 数字资产（digital） | 5 | ENS 域名 / NFT Pass / 数字藏品 |
| 软件源码（digital） | 5 | Next.js 模板 / VSCode 主题源码 / Python 爬虫脚本 |
| 游戏道具（digital） | 4 | Steam 游戏账号 / CS2 皮肤 / 原神账号 |
| 二手服饰（physical） | 6 | Supreme 卫衣 / AJ 1 / 古着外套 |

**动态部分**（`localStorage`）：用户发布的商品 + 模拟订单。键名：
- `c2c:items:user-published` —— 用户发布的 Item[]
- `c2c:orders` —— 模拟订单 Order[]
- `c2c:user:favorites` —— 收藏 ItemId[]

### 6.2 状态管理分层

```
Zustand stores
├── useItemStore        // 静态 mock + 用户发布合并
├── useFilterStore      // 筛选状态
├── useOrderStore       // localStorage 订单
├── useUserStore        // mock 当前用户（写死）
└── useFavoriteStore    // 收藏
```

### 6.3 响应式断点

| 设备 | 宽度 | 布局 |
|---|---|---|
| Web3 钱包内置浏览器 | 360-414px | 单列堆叠，底部 tab bar |
| Mobile H5 | 360-768px | 同上 |
| Tablet | 768-1024px | 双列 + 侧栏 |
| Desktop | > 1024px | 三列 + 顶栏 |

---

## 7. 待决策项（必须用户拍板才能继续）

### Q1：现有 mvp-spec.md / mvp-tickets.md 怎么办？

- A. **作废旧 spec**：旧 spec 移进 `docs/archive/mvp-spec-chain-escrow.md`，重写 v2
- B. **保留旧 spec**：旧 spec 是"产品终局"，本路线是"前端 demo 中间产物"
- C. **并存**：两份都是有效文档，按上下文选读

### Q3：前端框架

- 推荐 Next.js（理由 §3）
- 或 Nuxt.js

### Q4：UI 组件库

- 推荐 shadcn/ui（理由 §3）
- 或 Ant Design

**Q1 / Q3 / Q4 全部拍板后**，我会：
1. 更新本路线文档状态 `v0.1 草稿` → `v1.0 已批准`
2. 更新 `docs/CHANGELOG.md`
3. 按 Q1 决定是否动 `mvp-spec.md` / `mvp-tickets.md` / `problem.md`
4. 按 Q3 / Q4 生成 `package.json` 草案 + 目录结构（**不安装依赖**，等你确认）
5. 写 `docs/mock-data-spec.md` 落地 §4 schema + §6.1 的 30 条 mock 数据集

---

## 8. 与 problem.md 的衔接

problem.md 里 3 个 blocker + 7 个 yellow 的命运：

| ID | 一句话 | 在本路线下 |
|---|---|---|
| P1 Safe 多签 | 2-of-2 不是消除单点 | **完全失效**（本路线无链上） |
| P2 数字超时归谁 | 7d 未交付归买家/卖家 | **完全失效**（本路线无链上） |
| P3 markDelivered 边界 | 已交付但买家未确认 | **完全失效** |
| P4 S3 key 矛盾 | key 用 orderId 但 orderId 后有 | **降级为本地存储问题**（localStorage 不需要 key） |
| P5 后端托管文件 | 单方面发文件权限 | **完全失效** |
| P6 ETH 后期接入 | 写死 vs 参数化 | **本路线本来就 mock**（同时支持 ETH/USDT/SOL 三种 currency） |
| P7 Sepolia ETH | 新用户 onboarding | **完全失效**（无真钱包） |
| P8 T-501 E2E 超时 | 不测超时 | **完全失效**（无合约） |
| P9 admin 邮箱无二因素 | 单密码泄露 | **完全失效**（无 admin 控制台） |
| P10 Wagmi SSR hydration | Next.js App Router 风险 | **保留为后续接真钱包时的 yellow** |

Q1 拍 A 时，把 problem.md 改为"已 archive，问题随 mvp-spec 移入 archive"；Q1 拍 B/C 时，问题保留但状态标 `[!]`（本路线下不适用）。

---

## 9. 下一步

按 §7 等用户回答 Q1 / Q3 / Q4。**回答前不创建任何代码、不安装任何依赖、不动现有文件**。

回答后按 §7 后半段流程推进。