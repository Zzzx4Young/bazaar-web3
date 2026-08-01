# CryptoC2C — Crypto-Powered C2C Marketplace (Frontend Prototype)

> **项目代号**: CryptoC2C
> **当前阶段**: 纯前端原型 demo（Next.js + Mock 数据）
> **目标**: 服务海外加密社区的 C2C 二手交易平台，以 USDT / ETH 等加密货币为支付手段
> **状态**: 前端 prototype 已完成（7 个路由 build 通过 + dev server 实测）

---

## 🚀 Quick Start

```bash
cd frontend
npm install
npm run dev          # → http://localhost:3000
```

其他命令：

```bash
npm run build        # 生产构建
npm run typecheck    # TypeScript 检查
npm run lint         # ESLint
```

## ✨ 已实现的页面（7 个路由）

| 路由 | 内容 | 状态 |
|---|---|---|
| `/` | 首页（轮播 banner + 分类 tabs + 商品瀑布流） | ✓ |
| `/explore` | 列表 + 多维度筛选（关键词 / 分类 / 类型 / 币种 / 成色 / 排序） | ✓ |
| `/listing/[id]` | 详情页（媒体轮播 + Markdown + 卖家卡片 + BuyModal + ChatDrawer） | ✓ |
| `/publish` | 发布表单（实物 / 数字切换 + Zod 校验 + localStorage 持久化） | ✓ |
| `/me` | 个人中心（ProfileHeader + 订单 Tab + 收藏） | ✓ |
| `/seller/[id]` | 公开卖家页（头像 / 评价 / 在售商品） | ✓ |

**所有交互在 Sepolia 测试网模拟，0 真实资金**。

## 🛠️ 技术栈

- **框架**: Next.js 14 (App Router) + TypeScript 5
- **UI**: Tailwind CSS + shadcn/ui (Radix UI + lucide-react)
- **状态管理**: Zustand（带 localStorage 持久化）
- **表单**: React Hook Form + Zod
- **Markdown**: react-markdown + remark-gfm
- **媒体轮播**: embla-carousel-react
- **数据**: 25 条商品 / 6 个卖家 / 12 条订单 / 5 个 banner（mock JSON）

完整依赖见 `frontend/package.json`（25 项 runtime + 12 项 dev）。

## ⚠️ 这是原型，不是产品

- 0 后端（API Routes 没启用）
- 0 智能合约（mvp-spec.md 描述的链上 escrow **未实现**）
- 0 真钱包连接（WalletConnect **未集成**）
- 0 真实 KYC / 合规 / 审计
- 发布 / 购买 / 收藏 / 订单只写到 localStorage

**仅用于 UI 设计验证 / 投资人演示 / 内部 review**。

## 📚 文档结构

所有详细文档在 `docs/` 子目录。

### 🚀 当前活跃

| 文件 | 用途 | 状态 |
|---|---|---|
| [mvp-spec.md](./docs/mvp-spec.md) | 缩减版 A spec — 链上 escrow 真后端路线（**当前未实施，仅作存档**） | 存档 |
| [mvp-tickets.md](./docs/mvp-tickets.md) | 20 张 ticket（链上 escrow 路线，已被前端原型覆盖） | 存档 |
| [frontend-prototype-roadmap.md](./docs/frontend-prototype-roadmap.md) | 纯前端原型路线规划 | ✓ 已落地 |
| [frontend-stack-recommendation.md](./docs/frontend-stack-recommendation.md) | Next.js + shadcn/ui 技术选型 | ✓ 已落地 |
| [mock-data-spec.md](./docs/mock-data-spec.md) | 25 条商品 + 6 个卖家 + 12 条订单 mock 规格 | ✓ 已落地 |
| [problem.md](./docs/problem.md) | review findings — spec 待决策 10 条 | 部分待决 |
| [hook-issues.md](./docs/hook-issues.md) | Hermes verification hook 修复记录 | ✓ 已修复 |
| [CHANGELOG.md](./docs/CHANGELOG.md) | 变更日志 | ✓ |

### 🗄️ 已冻结（决策存档）

[01-product-overview.md](./docs/01-product-overview.md) · [02-market-analysis.md](./docs/02-market-analysis.md) · [03-compliance.md](./docs/03-compliance.md) · [04-architecture.md](./docs/04-architecture.md) · [05-payment-flow.md](./docs/05-payment-flow.md) · [06-tech-stack.md](./docs/06-tech-stack.md) · [07-mvp-roadmap.md](./docs/07-mvp-roadmap.md) · [08-revenue-model.md](./docs/08-revenue-model.md) · [09-risks.md](./docs/09-risks.md) · [10-references.md](./docs/10-references.md)

---

## 🎯 项目背景（保留 spec 核心陈述）

**问题**: 全球加密货币持有者约 5 亿，但**使用加密货币购买实物商品**的渠道极为有限 —— 大多数电商不支持加密支付，而专门面向加密社区的二手交易平台几乎空白。

**本路线（纯前端原型）的目的**：在投入链上 escrow + 真后端 + 合规成本前，先用 UI 原型验证产品形态、设计语言、用户旅程是否合理。

**完整产品终局路线**：见 [mvp-spec.md](./docs/mvp-spec.md) 与 [00-project-flow.md](./docs/00-project-flow.md) — 链上 escrow + Gnosis Safe 多签 + 邮箱验证 + Sepolia 测试网，不接中国大陆用户。

## 📂 项目结构

```
crypto-c2c/
├── README.md                     ← 你正在读
├── frontend/                     ← Next.js 14 + shadcn/ui 项目
│   ├── src/
│   │   ├── app/                  ← 路由 (7 个页面)
│   │   ├── components/           ← UI 组件 (home/listing/publish/me/explore + shadcn/ui)
│   │   ├── stores/               ← Zustand stores (5 个)
│   │   ├── lib/                  ← 工具函数 + mock data
│   │   ├── hooks/                ← custom hooks
│   │   ├── types/                ← TS 类型定义
│   │   └── mock/                 ← 25+6+12+5 mock JSON
│   ├── package.json
│   └── ...
└── docs/                         ← 完整文档
    ├── frontend-prototype-roadmap.md
    ├── mvp-spec.md
    ├── mvp-tickets.md
    ├── mock-data-spec.md
    ├── problem.md
    ├── hook-issues.md
    ├── CHANGELOG.md
    └── 01-10*.md (frozen)
```

## 📞 联系方式（占位）

待补充。

## 📝 许可证

待定。