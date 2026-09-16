# 前端技术栈与启动

状态：当前有效，记录实际实现。更新：2026-09-16。范围：服务端 Alpha 前端。

## 技术栈

| 层面 | 实际选择 |
|---|---|
| 应用 | Next.js 14 App Router、React 18、TypeScript 5 严格模式 |
| 样式/UI | Tailwind CSS 3、Radix 基础组件、shadcn/ui 风格本地源码、Lucide |
| 表单 | React Hook Form + Zod |
| 国际化 | next-intl 4；`zh-CN` / `en`，始终使用语言前缀 |
| 状态 | 认证与筛选使用 Zustand；收藏 ID 使用 localStorage |
| 数据 | 同源 `/api` 代理读取 NestJS/PostgreSQL；页面不使用静态业务数据 |
| 内容 | react-markdown + remark-gfm、Embla 轮播 |
| 验证 | Vitest + Testing Library + happy-dom；Playwright Chromium |
| 工程 | npm、ESLint、Prettier、GitHub Actions；Vercel 部署配置 |

依赖范围以 `frontend/package.json` 为准，锁定版本以 `frontend/package-lock.json` 为准。不使用 Wagmi、Viem、WalletConnect、认证服务或数据库。

## 目录

```text
frontend/
  src/app/[locale]/  页面及根布局
  src/components/    layout / home / explore / listing / publish / me / ui
  src/stores/        认证、收藏、筛选
  src/hooks/         服务端商品读取
  src/lib/           API 客户端、筛选、格式化
  src/types/         TS 数据契约
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

开发时通过 `BACKEND_ORIGIN` 指向 NestJS，默认 `http://127.0.0.1:3001`。商品无媒体时使用
本地占位图。

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

`npm run test:e2e` 使用隔离 PostgreSQL 和 Chromium 执行完整 Alpha 流程；CI 同样运行该入口。
生产镜像和完整 Compose 见基础设施文档。

## 实现限制

账户、商品、订单和私有交付由服务端持久化；主题和收藏 ID 是浏览器偏好。注册、图片上传、
通知服务、真实支付与钱包仍未实现。详见路线文档。
