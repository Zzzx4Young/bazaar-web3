# Bazaar Web3 前端 Alpha

Next.js 14 + React 18 + TypeScript。Alpha 通过同源 `/api` 代理连接 NestJS 后端；真实账户、商品、订单和交付数据由后端提供。未登录页面仍保留明确标注的 Demo 展示组件。

要求 Node >=22.12.0、npm 10.9.8。在此目录执行：

```bash
npm ci
npm run dev
# http://localhost:3000/zh-CN 或 /en
```

开发时后端默认位于 `http://127.0.0.1:3001`；可用 `BACKEND_ORIGIN` 覆盖。生产运行使用 `npm run build` 后 `npm run start`，部署时需让后端 `APP_ORIGIN` 等于浏览器访问的完整前端 origin。

API 客户端为请求生成 `X-Request-Id`。失败时 `BackendError` 保留服务端的稳定错误码、HTTP 状态、`requestId` 和 `retryable`，供内测问题记录关联，不作为身份或幂等键。

完整静态与构建检查使用 `npm run check:frontend`。`npm run test:e2e` 是真实 Alpha
Chromium 验收入口，会从 `backend/` 运行隔离数据库流程；执行前需启动专用
`postgres-test`。旧 Demo 浏览器回归保留为 `npm run test:e2e:demo`。

- [文档入口](../docs/README.md)
- [当前范围与后续规划](../docs/frontend-prototype-roadmap.md)
- [技术栈和架构](../docs/frontend-stack-recommendation.md)
- [历史 Demo 数据格式](../docs/mock-data-spec.md)

Alpha 订单动作使用幂等键；结果未知时只能复用原请求重试。真实钱包、链上结算、注册、图片托管和通知系统仍不在范围内。旧本地订单 E2E 属于 Demo 范围，不作为后端 Alpha 验收证据。
