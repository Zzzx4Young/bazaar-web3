# Mock 数据集规格

> **状态**：v0.1 草案，与 [frontend-prototype-roadmap.md](./frontend-prototype-roadmap.md) §6.1 对应
> **生成日期**：2026-07-31
> **关联**：[frontend-prototype-roadmap.md §4 schema](./frontend-prototype-roadmap.md) / [mvp-spec.md §3 业务故事](./mvp-spec.md)

---

## 0. 数据集总览

**总量**：30 条商品 + 6 个卖家 + 12 条 mock 订单 + 5 个 banner 位

| 大类 | 数量 | 物品 vs 数字比例 | mock 重点 |
|---|---:|---|---|
| 电子数码 (electronics) | 5 | 5 物理 / 0 数字 | 二手手机、笔记本、耳机 |
| 数字资产 (digital_assets) | 5 | 0 物理 / 5 数字 | ENS 域名、POAP、NFT Pass |
| 软件源码 (software_source) | 5 | 0 物理 / 5 数字 | Next.js 模板、爬虫脚本、主题 |
| 游戏道具 (game_items) | 5 | 0 物理 / 5 数字 | Steam 账号、CS2 皮肤、原神账号 |
| 二手服饰 (secondhand_fashion) | 5 | 5 物理 / 0 数字 | Supreme、AJ、古着 |
| **合计** | **25** | 10 物理 / 15 数字 | — |

> **注**：standing goal 说"20-30 条"，本规格定 **25 条**。预留扩展空间。

---

## 1. 媒体资源策略

**原则**：不接 S3 / R2，**用公开占位图服务**。

| 服务 | 用途 | URL 模式 |
|---|---|---|
| `placehold.co` | 通用占位（任意比例） | `https://placehold.co/600x400/222/fff?text=iPhone+15` |
| `picsum.photos` | 真实摄影占位 | `https://picsum.photos/seed/{seed}/600/400` |
| `boring-avatars` | 卖家头像（生成式） | 内置 React 组件，无需 URL |
| `dicebear` | 头像备选 | `https://api.dicebear.com/7.x/avataaars/svg?seed={name}` |

**好处**：
- 无图片托管成本
- 删 demo 时无残留资源
- 网络依赖 1-2 个稳定服务

---

## 2. 6 个 mock 卖家

```ts
const sellers = [
  {
    id: 'seller_001',
    displayName: 'crypto_dev_alice',
    avatarSeed: 'alice',
    joinedAt: '2024-08-12T00:00:00Z',
    completedOrders: 142,
    rating: 4.9,
    ratingCount: 138,
    activeItemIds: ['item_001', 'item_002']
  },
  {
    id: 'seller_002',
    displayName: 'bob_sneakers',
    avatarSeed: 'bob',
    joinedAt: '2025-01-03T00:00:00Z',
    completedOrders: 87,
    rating: 4.7,
    ratingCount: 85,
    activeItemIds: ['item_021', 'item_022', 'item_023']
  },
  {
    id: 'seller_003',
    displayName: 'ens_trader',
    avatarSeed: 'ens',
    joinedAt: '2023-11-20T00:00:00Z',
    completedOrders: 56,
    rating: 5.0,
    ratingCount: 54,
    activeItemIds: ['item_006', 'item_007']
  },
  {
    id: 'seller_004',
    displayName: 'mobile_zone',
    avatarSeed: 'mobile',
    joinedAt: '2024-05-18T00:00:00Z',
    completedOrders: 234,
    rating: 4.6,
    ratingCount: 228,
    activeItemIds: ['item_001', 'item_002', 'item_003', 'item_004', 'item_005']
  },
  {
    id: 'seller_005',
    displayName: 'code_market',
    avatarSeed: 'code',
    joinedAt: '2024-02-14T00:00:00Z',
    completedOrders: 178,
    rating: 4.8,
    ratingCount: 175,
    activeItemIds: ['item_011', 'item_012', 'item_013', 'item_014', 'item_015']
  },
  {
    id: 'seller_006',
    displayName: 'gamer_swap',
    avatarSeed: 'gamer',
    joinedAt: '2025-03-08T00:00:00Z',
    completedOrders: 92,
    rating: 4.5,
    ratingCount: 90,
    activeItemIds: ['item_016', 'item_017', 'item_018']
  }
]
```

**当前用户**（mock）：`currentUser = sellers[0]`（alice）。

---

## 3. 25 条 mock 商品

### 3.1 电子数码（5 条 · 全部 physical）

```ts
{
  id: 'item_001',
  sellerId: 'seller_004',
  title: 'iPhone 15 Pro 256GB 自然钛色 99新',
  description: '## 出售 iPhone 15 Pro\n\n- 颜色：自然钛色\n- 存储：256GB\n- 电池循环：87 次\n- 配件：原装充电线 + 保护壳\n- 无磕碰无划痕',
  category: 'physical',
  tags: ['99新', 'iPhone', '未拆封'],
  price: { amount: 6899, currency: 'CNY', fiatEstimate: 950 },
  originalPrice: { amount: 7999, currency: 'CNY' },
  condition: 'like_new',
  shippingMethod: 'delivery',
  media: [
    { type: 'image', url: 'https://placehold.co/600x800/1a1a2e/fff?text=iPhone+Front', alt: 'iPhone 正面' },
    { type: 'image', url: 'https://placehold.co/600x800/16213e/fff?text=iPhone+Back', alt: 'iPhone 背面' },
    { type: 'image', url: 'https://placehold.co/600x800/0f3460/fff?text=Screen+On', alt: '亮屏' }
  ],
  status: 'active',
  viewCount: 1245,
  favoriteCount: 87,
  createdAt: '2026-07-25T10:00:00Z'
}
```

其余 4 条电子数码 placeholder：

- `item_002`: MacBook Air M2 13" 16GB / 512GB · 95新 · ¥7,200
- `item_003`: Sony WH-1000XM5 黑色 · 9成新 · ¥1,899
- `item_004`: iPad Pro 11" M4 · 99新 · ¥7,899
- `item_005`: Nintendo Switch OLED · 95新 · ¥1,650

### 3.2 数字资产（5 条 · 全部 digital）

```ts
{
  id: 'item_006',
  sellerId: 'seller_003',
  title: 'ENS 域名：crypto.eth (4字符 · 优质)',
  description: '## ENS 域名出售\n\n- 域名：`crypto.eth`\n- 字符：4 字符\n- 注册时间：2022-03\n- 续费至：2028-03\n- 可议价 · 接受 USDT',
  category: 'digital',
  tags: ['ENS', '4字符', '优质短域名'],
  price: { amount: 12.5, currency: 'ETH', fiatEstimate: 42500 },
  originalPrice: { amount: 15, currency: 'ETH' },
  deliveryType: 'download_link',
  deliveryPreview: '买家付款后通过站内信发送 Registrar 转移链接',
  media: [
    { type: 'image', url: 'https://placehold.co/600x400/0e0e2c/fff?text=crypto.eth', alt: 'ENS 域名' }
  ],
  status: 'active',
  viewCount: 892,
  favoriteCount: 134,
  createdAt: '2026-07-20T08:00:00Z'
}
```

其余 4 条数字资产 placeholder：

- `item_007`: ENS `web3.eth` (4字符) · 9.8 ETH
- `item_008`: POAP Pass · Devcon 2024 · 0.05 ETH
- `item_009`: NFT Pass · 某项目白名单 × 5 个 · 0.5 ETH
- `item_010`: Galxe OAT · 早期用户徽章 · 0.02 ETH

### 3.3 软件源码（5 条 · 全部 digital）

- `item_011`: Next.js 14 SaaS 模板 · 完整项目源码 · 0.3 ETH
- `item_012`: Python 爬虫脚本 · 通用框架 · 0.08 ETH
- `item_013`: VSCode 主题包 · 5 套 · 0.02 ETH
- `item_014`: React 组件库 · 50+ 组件 · 0.15 ETH
- `item_015`: Tailwind UI Kit · 商用授权 · 0.05 ETH

**deliveryType 全部** `download_link`（GitHub repo 或网盘链接）

### 3.4 游戏道具（5 条 · 全部 digital）

- `item_016`: Steam 账号 · 300+ 游戏 · CS2 高库存 · 议价
- `item_017`: CS2 皮肤 · AK-47 红线 · 0.85 ETH
- `item_018`: 原神账号 · 冒险等阶 60 · 5+ 5星角色 · 议价
- `item_019`: Minecraft 账号 · 十年老号 · 0.05 ETH
- `item_020`: 游戏充值卡 · 100 USD · 0.03 ETH（数字卡密）

**deliveryType 混合**：`account_credentials` / `license_key`

### 3.5 二手服饰（5 条 · 全部 physical）

- `item_021`: Supreme Box Logo Hoodie FW22 · 95新 · ¥4,200
- `item_022`: Air Jordan 1 "Chicago" · 9成新 · ¥3,899
- `item_023': Vintage 古着外套 · 80s Levis Type III · ¥680
- `item_024`: Yeezy Boost 350 V2 · 95新 · ¥1,899
- `item_025`: 北面 Nuptse 700 蓬羽绒服 · 99新 · ¥1,580

**condition 全部** `like_new` 或 `good`，**shippingMethod 全部** `delivery`

---

## 4. 12 条 mock 订单

> **当前用户 alice (seller_001)** 同时也是部分订单的买家。

```ts
const orders = [
  // alice 卖出（3 条）
  { id: 'order_001', itemId: 'item_001', buyerId: 'user_anon_1', sellerId: 'seller_001', amount: { amount: 6899, currency: 'CNY' }, status: 'completed', createdAt: '2026-07-15T...', role: 'seller' },
  { id: 'order_002', itemId: 'item_002', buyerId: 'user_anon_2', sellerId: 'seller_001', amount: { amount: 7200, currency: 'CNY' }, status: 'pending_confirm', createdAt: '2026-07-28T...', role: 'seller' },
  { id: 'order_003', itemId: 'item_011', buyerId: 'user_anon_3', sellerId: 'seller_001', amount: { amount: 0.3, currency: 'ETH' }, status: 'pending_fulfillment', createdAt: '2026-07-30T...', role: 'seller' },
  // alice 买入（4 条）
  { id: 'order_004', itemId: 'item_006', buyerId: 'seller_001', sellerId: 'seller_003', amount: { amount: 12.5, currency: 'ETH' }, status: 'completed', createdAt: '2026-06-20T...', role: 'buyer' },
  { id: 'order_005', itemId: 'item_012', buyerId: 'seller_001', sellerId: 'seller_005', amount: { amount: 0.08, currency: 'ETH' }, status: 'completed', createdAt: '2026-07-10T...', role: 'buyer' },
  { id: 'order_006', itemId: 'item_021', buyerId: 'seller_001', sellerId: 'seller_002', amount: { amount: 4200, currency: 'CNY' }, status: 'pending_payment', createdAt: '2026-07-30T...', role: 'buyer' },
  { id: 'order_007', itemId: 'item_017', buyerId: 'seller_001', sellerId: 'seller_006', amount: { amount: 0.85, currency: 'ETH' }, status: 'cancelled', createdAt: '2026-07-22T...', role: 'buyer' },
  // 其他用户订单（5 条 · 用于订单页"全部订单"展示 demo）
  { id: 'order_008', itemId: 'item_003', buyerId: 'user_anon_4', sellerId: 'seller_004', amount: { amount: 1899, currency: 'CNY' }, status: 'completed', createdAt: '2026-07-12T...' },
  { id: 'order_009', itemId: 'item_007', buyerId: 'user_anon_5', sellerId: 'seller_003', amount: { amount: 9.8, currency: 'ETH' }, status: 'completed', createdAt: '2026-07-18T...' },
  { id: 'order_010', itemId: 'item_013', buyerId: 'user_anon_6', sellerId: 'seller_005', amount: { amount: 0.02, currency: 'ETH' }, status: 'completed', createdAt: '2026-07-05T...' },
  { id: 'order_011', itemId: 'item_022', buyerId: 'user_anon_7', sellerId: 'seller_002', amount: { amount: 3899, currency: 'CNY' }, status: 'pending_confirm', createdAt: '2026-07-29T...' },
  { id: 'order_012', itemId: 'item_018', buyerId: 'user_anon_8', sellerId: 'seller_006', amount: { amount: 0, currency: 'CNY' }, status: 'pending_payment', createdAt: '2026-07-31T...' }
]
```

**订单状态分布**：
- `completed`: 6 条
- `pending_confirm`: 2 条
- `pending_fulfillment`: 1 条
- `pending_payment`: 2 条
- `cancelled`: 1 条

---

## 5. 5 个 Banner

```ts
const banners = [
  {
    id: 'banner_001',
    title: '🎉 平台上线测试中 · 限时 0 手续费',
    subtitle: '所有交易免 escrow 手续费 · 仅限 Sepolia 测试网',
    image: 'https://placehold.co/1200x400/4338ca/fff?text=Launch+Banner',
    link: '/explore?category=electronics',
    active: true
  },
  {
    id: 'banner_002',
    title: 'ENS 域名专场 · 优质 4 字符',
    subtitle: 'crypto.eth / web3.eth / nft.eth 限时开放',
    image: 'https://placehold.co/1200x400/0e7490/fff?text=ENS+Special',
    link: '/explore?category=digital_assets',
    active: true
  },
  {
    id: 'banner_003',
    title: '二手 99 新数码专场',
    subtitle: 'iPhone / MacBook / iPad · 平台担保交易',
    image: 'https://placehold.co/1200x400/be185d/fff?text=Electronics',
    link: '/explore?category=electronics',
    active: true
  },
  {
    id: 'banner_004',
    title: '源码市场 · 商用授权',
    subtitle: 'Next.js / React / Tailwind 模板与组件库',
    image: 'https://placehold.co/1200x400/047857/fff?text=Source+Code',
    link: '/explore?category=software_source',
    active: true
  },
  {
    id: 'banner_005',
    title: '潮牌二手 · 鉴定后发货',
    subtitle: 'Supreme / AJ / Yeezy · 全程平台 escrow',
    image: 'https://placehold.co/1200x400/7c2d12/fff?text=Fashion',
    link: '/explore?category=secondhand_fashion',
    active: true
  }
]
```

---

## 6. 文件落点（实现时）

```
frontend/src/mock/
├── items.json          // 25 条商品（去 Seller 嵌套引用，单独 store 缓存）
├── sellers.json        // 6 个卖家
├── orders.json         // 12 条订单
├── banners.json        // 5 个 banner
└── categories.json     // 5 个一级分类 + 子分类（参考 frontend-prototype-roadmap §4.4）
```

**约束**：
- 媒体 URL 仅用 `placehold.co` + `picsum.photos` + `dicebear` —— 不接私有 CDN
- 所有 createdAt / updatedAt 用静态时间戳，**不依赖 `new Date()`**（避免 SSR/CSR mismatch）
- ID 用 `item_001` / `seller_001` 这种 string，**不**用 UUID

---

## 7. localStorage 数据契约

发布流程写入 3 个 key：

```ts
// 1. 用户发布的商品（追加到 mock 列表）
localStorage['c2c:items:user-published']: Item[]
// 2. 模拟订单（购买/发布都会创建）
localStorage['c2c:orders']: Order[]
// 3. 收藏列表
localStorage['c2c:user:favorites']: string[]  // ItemId[]
```

**生命周期**：
- 写入时机：发布表单提交 / 模拟购买 modal 确认 / 收藏按钮点击
- 读取时机：每次 Zustand store 初始化时合并静态 JSON + localStorage
- 清理时机：浏览器刷新 / localStorage 配额满（**不主动清理** —— demo 用途）

---

## 8. 下一步

按 [frontend-prototype-roadmap.md §7](./frontend-prototype-roadmap.md) 流程：

1. 等用户回答 **Q1**（spec 处置：A/B/C）
2. 等用户回答 **Q4**（UI 库：shadcn/ui 推荐 / Ant Design）
3. Q1 + Q4 都拍板后，**生成 `frontend/` 项目骨架**（含 `package.json` / `tsconfig.json` / `tailwind.config.ts` / Next.js 配置），**不安装依赖**
4. 二次确认后**安装依赖 + 落地本规格的 mock JSON 文件**