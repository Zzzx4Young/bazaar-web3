# Bazaar Web3 前端演示版

Next.js 14 + React 18 + TypeScript。仅 UI、Mock 数据和浏览器本地持久化，没有后端、真实钱包或合约。

要求 Node >=22.12.0、npm 10.9.8。在此目录执行：

```bash
npm ci
npm run dev
# http://localhost:3000/zh-CN 或 /en
```

无需 `.env`。生产运行使用 `npm run build` 后 `npm run start`。

检查：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`。浏览器验证：`npx playwright install chromium`，随后 `npm run test:e2e`。

- [文档入口](../docs/README.md)
- [当前范围与后续规划](../docs/frontend-prototype-roadmap.md)
- [技术栈和架构](../docs/frontend-stack-recommendation.md)
- [数据与持久化契约](../docs/mock-data-spec.md)

发布、收藏及模拟订单刷新后保留；清除浏览器站点数据后丢失。商品上传、草稿、真实交付、订单结算和完整业务双语仍未实现。
