# Frontend

> **状态**：占位目录，等 Q1（spec 处置）+ Q4（UI 库）拍板后填入源码与配置。
> **关联文档**：
> - [frontend-prototype-roadmap.md](../docs/frontend-prototype-roadmap.md) — 总体规划
> - [frontend-stack-recommendation.md](../docs/frontend-stack-recommendation.md) — 技术选型表
> - [mock-data-spec.md](../docs/mock-data-spec.md) — 25 条商品 + 6 个卖家 + 12 条订单

## 当前内容

本目录已有 **17 个项目文件**：

- **10 个配置文件**：package.json / tsconfig.json / next.config.mjs / tailwind.config.ts / postcss.config.mjs / components.json / .eslintrc.json / .prettierrc / .gitignore / README.md
- **7 个源码文件**（最小可启动）：
  - `src/app/layout.tsx` —— 根布局
  - `src/app/page.tsx` —— 首页
  - `src/app/globals.css` —— Tailwind + shadcn 主题变量
  - `src/app/explore/page.tsx` —— 探索占位
  - `src/app/publish/page.tsx` —— 发布占位
  - `src/app/me/page.tsx` —— 我的占位
  - `src/lib/utils.ts` —— shadcn `cn()` helper
- **node_modules/**：422 MB，551 个 npm 包

## 验证状态（已实跑）

```
$ npx tsc --noEmit     → exit=0 (0 TS errors)
$ npx next lint        → exit=0 (No ESLint warnings or errors)
$ npx next build       → exit=0 (5 routes prerendered, 87.4 kB First Load JS)
```

## 当前文件清单

```
frontend/
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json
├── .eslintrc.json
├── .prettierrc
├── .gitignore
├── node_modules/                      ← 422 MB
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx
    │   ├── globals.css
    │   ├── explore/page.tsx
    │   ├── publish/page.tsx
    │   └── me/page.tsx
    └── lib/
        └── utils.ts
```

## 启动命令

```bash
cd crypto-c2c/frontend
npm run dev                  # 起 dev server，访问 http://localhost:3000
npm run build                # 生产构建
npm run typecheck            # 类型检查
npm run lint                 # ESLint
```

## 下一步落点

- [ ] 落地 TS 类型定义（item.ts / seller.ts / order.ts / user.ts / category.ts）
- [ ] 落地 mock JSON 数据（items.json / sellers.json / orders.json / banners.json / categories.json）
- [ ] 装 shadcn 实际组件（Button / Card / Dialog / Sheet / Form / Input / Select / Slider / Badge / Avatar / Skeleton / Tabs / Toast）
- [ ] 落地 Zustand stores（useItemStore / useFilterStore / useOrderStore / useUserStore / useFavoriteStore）
- [ ] 实现首页真实 UI（HeroBanner 轮播 + CategoryTabs + ItemGrid）
- [ ] 实现列表页真实 UI（FilterSidebar + 无限加载）
- [ ] 实现详情页真实 UI（MediaCarousel + SellerCard + BuyModal + ChatDrawer）
- [ ] 实现发布页真实 UI（表单 + UploadDropzone + DigitalDeliveryForm）
- [ ] 实现个人中心真实 UI（ProfileHeader + OrderTable）
- [ ] 响应式适配（移动端 H5 / Web3 钱包内置浏览器）