# Bazaar 前端

Next.js 14 + React 18 + TypeScript。页面通过同源 `/api` 代理访问独立后端；
商品、账户、订单和评价来自 PostgreSQL。单独运行前端时，业务请求仍需后端服务。
完整项目启动见 [根 README](../README.md)。

## 页面与浏览器状态

| 路由（前面加 `/zh-CN` 或 `/en`） | 能力 |
|---|---|
| `/`、`/explore`、`/listing/[id]` | 商品浏览、关键词与分类筛选、跨币种排序、分页和购买 |
| `/login`、`/publish`、`/me` | 登录、发布、卖家商品管理和个人订单 |
| `/cart`、`/me/checkouts/[id]` | 2–5 件跨卖家购物车与逐件订单状态 |
| `/me/orders/[id]` | 付款、交付、验收、争议、退款和完成后评价 |
| `/seller/[id]`、`/admin/disputes` | 卖家信誉及管理员争议处理 |
| `/favorites`、`/notifications` | 当前公开商品的本地收藏；通知为明确的未开放状态 |

收藏 ID 保存在浏览器本地存储，导航数量和收藏页都经
`POST /api/listings/favorites/resolve` 确认；失效或下架商品不计入数量。
同一组 ID 共享进行中的请求，每批最多 100 个 ID、每次解析最多并发两批；
最后一个订阅页面离开时取消未完成请求，不缓存已完成的旧结果。
批次上限在 `src/lib/favorites-policy.ts`，后端契约测试核对 API 与 OpenAPI 一致。
购物车按账户保存在 `sessionStorage`，提交后由后端原子创建订单。
数量限制集中在 `src/lib/cart-policy.ts`；后端契约测试校验其与 API 校验及 OpenAPI 一致。
商品卡片优先显示传入的媒体，缺图或图片加载失败时显示类目占位图；不存在强制隐藏媒体的演示开关。
聊天尚未接入后端，页面入口保持未开放；已移除本地伪造欢迎消息和卖家自动回复的组件。
接口失败时页面显示错误，不回退到演示商品或订单。浏览器 GET 页面与静态资源是正常请求；
业务 API 使用 POST-only 契约。
卖家主页按 20 件分页读取公开商品，展示数量以服务端 `total` 为准。
订单详情仅在已登录且页面可见时按 `src/lib/refresh-policy.ts` 的间隔轮询真实状态。
慢读取期间跳过轮询和聚焦刷新；交易后的主动刷新合并为一次后续读取，保持状态更新。
切换请求参数、会话或离开页面时取消旧读取，并忽略迟到响应。

## 开发与验收

需要 Node.js >=22.12、npm 10.9.8。在本目录执行：

```bash
npm ci
npm run dev
```

默认打开 http://localhost:3000/zh-CN；后端默认位于 `http://127.0.0.1:3001`，
可用 `BACKEND_ORIGIN` 覆盖。后端的 `APP_ORIGIN` 必须与浏览器访问的前端 origin 一致。
开发时如需打开登录框或 `/login` 页面后自动填充测试账号，在被 Git 忽略的
`frontend/.env.local` 中设置 `NEXT_PUBLIC_DEV_LOGIN_NAME` 和
`NEXT_PUBLIC_DEV_LOGIN_PASSWORD`，然后重启前端。两个值都会发送到浏览器，
仅能使用专门的本机测试账号；生产模式不自动填充。登录仍需手动点击提交。
生产构建使用 `npm run build` 后 `npm run start`；构建前先停止开发服务，避免共用 `.next` 输出。

```bash
npm run check:frontend
npm run test:e2e:alpha
npm run test:e2e:v2
```

浏览器验收会启动并停止专用 `postgres-test`，需要 Docker、Chromium 和仓库测试密码文件。
V2 在隔离数据库生成 200 件商品、60 笔多状态订单，覆盖移动/桌面布局、筛选排序、
购物车、争议裁决及 observer 数据核对；截图、视频和 trace 写入 `e2e-results-v2/`。
历史 Demo 用例由 `npm run test:e2e:demo` 单独运行，不作为 Alpha 验收。

客户端错误保留服务端错误码、HTTP 状态和 `requestId`，方便内测定位；
订单命令在结果未知时复用原请求和幂等键，按发起账户保存在 `sessionStorage`。
切换账户或退出登录后，前一账户的命令和迟到响应不会串入当前账户；切回时仍可同键核对。
缓存格式错误会被丢弃，浏览器存储不可用不会把已确认成功改为失败。
旧会话的迟到认证错误不会重定向新会话。接口字段见[后端 OpenAPI](../backend/openapi/alpha.json)。
