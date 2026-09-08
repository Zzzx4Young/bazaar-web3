# 前端技术栈与启动

状态：当前有效，记录实际实现。更新：2026-09-06。范围：[前端演示版](frontend-prototype-roadmap.md)。

## 技术栈

| 层面 | 实际选择 |
|---|---|
| 应用 | Next.js 14 App Router、React 18、TypeScript 5 严格模式 |
| 样式/UI | Tailwind CSS 3、Radix 基础组件、shadcn/ui 风格本地源码、Lucide |
| 表单 | React Hook Form + Zod |
| 国际化 | next-intl 4；`zh-CN` / `en`，始终使用语言前缀 |
| 状态 | 用户/筛选/订单使用 Zustand；商品/收藏通过共享事件的 localStorage Hook |
| 数据 | JSON 静态导入与本地新增数据，无 API Routes、MSW 或请求层 |
| 内容 | react-markdown + remark-gfm、Embla 轮播 |
| 验证 | Vitest + Testing Library + happy-dom；Playwright Chromium |
| 工程 | npm、ESLint、Prettier、GitHub Actions；Vercel 部署配置 |

依赖范围以 `frontend/package.json` 为准，锁定版本以 `frontend/package-lock.json` 为准。不使用 Wagmi、Viem、WalletConnect、认证服务或数据库。

## 目录

```text
frontend/
  src/app/[locale]/  页面及根布局
  src/components/    layout / home / explore / listing / publish / me / ui
  src/stores/        商品、收藏、订单、筛选、用户
  src/hooks/         本地存储恢复与同步
  src/lib/           数据入口、筛选、格式化
  src/types/         TS 数据契约
  src/mock/          静态数据
  src/i18n/          请求配置、导航、路由
  messages/          中英文翻译
  tests/             单元、组件、浏览器测试
```

## 启动与检查

工程统一使用 npm（`npm@10.9.8`）。Node 要求 `>=22.12.0`，与锁定的开发工具兼容；CI 使用 Node 22。

```bash
cd frontend
npm ci
npm run dev
# http://localhost:3000/zh-CN 或 /en
```

不需要 `.env`。商品卡默认本地占位图；部分详情媒体、头像依赖外部图片服务。可选 `NEXT_PUBLIC_USE_PLACEHOLDER=0` 开启商品卡图片请求。

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run start
# 浏览器测试首次使用时需要安装 Chromium
npx playwright install chromium
npm run test:e2e
```

Playwright 自动启动或复用 `3737` 端口开发服务。CI 执行类型、Lint、单元测试和构建，暂不执行 E2E。Vercel 应用根目录设置为 `frontend`；标准 Node 环境也可通过 build/start 运行，不能宣称只支持 Vercel。

## 实现限制

浏览器持久化在挂载后恢复，服务端无法读取本地发布和收藏。没有共享账户或跨设备数据。界面主题与导航支持双语，但业务页面翻译、逐页 metadata、完整筛选 URL 同步和上传仍待完善。详见路线文档。
