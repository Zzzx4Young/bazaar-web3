> 历史归档（2026-09-08）：仅供追溯，不是当前实施规范。当前入口：[文档索引](../README.md)。原文中的当前状态、待办、估时和建议均为历史记录。

# MVP Ticket Breakdown — 缩减版 A

> **状态**：历史测试网 MVP 工单，暂缓实施，不可直接领取。2026-09-06 复核：规则、接口和估时需重新制定。见 [文档入口](../README.md) 与 [复核记录](../review-corrections.md)。
> **生成日期**：2026-07-28
> **生成方式**：`/to-tickets` 从 `mvp-spec.md` Section 3 + 4 派生
> **来源依赖**：历史生成时引用 `mvp-spec.md` §0；“A1–A10 已全部确认”的旧声明不适用于当前阶段。未决项以 [复核记录](../review-corrections.md) 为准。
> **执行纪律**：每张 ticket 在 fresh context 窗口下完成；完成后 `/code-review` review 再 commit。

---

## 0. Tracker

本项目没有 GitHub/Lab 等外部 issue tracker。Ticket 落在本文件，每张有编号 `T-NNN`、状态列、单人完成时间（按 2 人实际人月换算——单人工时按 1 人 1 周 = 40h 计）。

**状态图**：
```
[ ] = 历史未实施（当前不可领取）
[~] = in-progress（被领取）
[x] = done（被 review + commit）
[!] = blocked（须人工介入）
```

每张 ticket 完成后**就地**把状态改掉（仅在测试网路线重新批准后作为工单记录），并 append 一行完成的 commit SHA 到文末 changelog。

---

## 1. 前置约束

所有 ticket 默认假设以下工具就绪：

- `node` 20+ + `pnpm`
- `foundry`（合约）
- `git` + GitHub repo（host 后续选；现在不假设特定 host）
- Sepolia 测试 ETH + Sepolia 测试 USDT（这是 A3 默认）

**T-000：仓库脚手架**（必须最先做，所有 ticket 都依赖）

| 字段 | 内容 |
|---|---|
| 标题 | 仓库脚手架 + tsconfig + foundry config + CI 占位 |
| Blocked by | None（仅历史依赖，不代表可开工） |
| 状态 | `[ ]` |
| 时间预算 | 0.5 人天 |
| 交付 | monorepo：`packages/contracts/`（Foundry）、`packages/web/`（Next.js）、`packages/api/`（Fastify）、`packages/shared/`（TS 类型）。`.github/workflows/ci.yml`：跑合约 test + 后端 lint + 前端 typecheck；部署先留 stub |
| 验收 | `pnpm i && pnpm -r build` 成功；`cd packages/contracts && forge test` 空测试通过；`cd packages/web && pnpm dev` 出首页占位；`cd packages/api && pnpm dev` 出 200 OK on `/health` |
| 不做 | 任何业务实现；任何 deployment；任何 UI |

═══════════════════════════════════════════════

## 2. 合约层（7 张）

> **路径**：`packages/contracts/`
> **约束**：单一合约 `Escrow.sol`（不是工厂模式，§0 A6）。所有票上 Sepolia 测试网。

### T-100：USDT Mock + 测试基础设施

| 字段 | 内容 |
|---|---|
| 标题 | Sepolia USDT 测试接口 + Foundry 测试基础 |
| Blocked by | T-000 |
| 状态 | `[ ]` |
| 时间 | 0.3 人天 |
| 交付 | `packages/contracts/test/mocks/MockUSDT.sol`（带 mint 给任何地址的便捷函数）；`packages/contracts/test/BaseTest.sol`（setUp 部署 mock USDT 并给 buyer/seller/arbiter 各 mint 1000 USDT） |
| 验收 | `forge test` 跑通 1 个空测试（仅 BaseTest 部署成功） |
| 不做 | 不写 Escrow 合约逻辑 |

### T-110：Escrow 主体合约 — 资金锁定

| 字段 | 内容 |
|---|---|
| 标题 | 编写 Escrow.sol：State enum + Order struct + fund 流程 |
| Blocked by | T-100 |
| 状态 | `[ ]` |
| 时间 | 1 人天 |
| 交付 | `Escrow.sol`：State enum（AWAITING_PAYMENT / FUNDED / DELIVERED / RELEASED / REFUNDED / DISPUTED）、Order struct、`createOrder()`（anyone 给 orderId + seller + amount + isDigital，emit Open）、`fund(orderId)`（buyer 转 USDT 进 escrow，要求 buyer 已 approve） |
| 验收 | 测试：create + fund happy path；非 buyer 调 fund revert；金额不匹配 revert |
| 不做 | release / dispute / 自动释放 / fee 累计（后续 ticket） |

### T-120：Escrow — release 与 fee 累计

| 字段 | 内容 |
|---|---|
| 标题 | 编写 release() + pendingFees + withdrawFees() |
| Blocked by | T-110 |
| 状态 | `[ ]` |
| 时间 | 0.7 人天 |
| 交付 | `release(orderId)`：仅 arbiter/admin 调用；扣 1%，seller 收到 99%，fee 进 `pendingFees[platformAdmin]`；`withdrawFees()`：platformAdmin 提取 |
| 验收 | 测试：release 正确拆分；非 admin 调用 revert；fee 累计正确；withdraw 后 pendingFees = 0 |
| 不做 | dispute、refund、自动超时 |

### T-130：Escrow — 数字商品自动释放 + 标记交付

| 字段 | 内容 |
|---|---|
| 标题 | 实现 markDelivered + 数字商品 7d 自动 release |
| Blocked by | T-120 |
| 状态 | `[ ]` |
| 时间 | 1 人天 |
| 交付 | `markDelivered(orderId)` 仅 seller 调用，进入 DELIVERED 并记录 deliveredAt。原“FUNDED 超 7 天未交付仍给卖家放款”规则已撤回；建议未交付超时退款、已交付且无争议超时放款，但时间起点、期限和 D1 下载授权须统一决策后实施。 |
| 验收 | 待规则批准后覆盖 FUNDED、DELIVERED、DISPUTED 和所有终态；包括临界时间、重复调用和非法操作者。 |
| 不做 | 实物确认收货流程（下一张票） |

### T-140：Escrow — 实物 confirmReceived + 14d 超时退款

| 字段 | 内容 |
|---|---|
| 标题 | confirmReceived + physical 超时退款 |
| Blocked by | T-130 |
| 状态 | `[ ]` |
| 时间 | 1 人天 |
| 交付 | `confirmReceived(orderId)`：仅 buyer 调用；state 走 DELIVERED → RELEASED；`autoRelease(orderId)` 增加分支：physical + FUNDED + now > fundedAt + 14d + 卖家未 markDelivered → refund 给 buyer |
| 验收 | 测试：physical happy path；physical 超时 refund；digital 仍走 T-130 路径不互相干扰 |
| 不做 | dispute |

### T-150：Escrow — dispute + resolve

| 字段 | 内容 |
|---|---|
| 标题 | dispute() + resolve(releaseToSeller) |
| Blocked by | T-140 |
| 状态 | `[ ]` |
| 时间 | 0.5 人天 |
| 交付 | `dispute(orderId)`：buyer 或 seller，state → DISPUTED，记录 openedBy；`resolve(orderId, releaseToSeller)`：仅 admin；true → 走 release 路径，false → 退款给 buyer |
| 验收 | 测试：dispute happy path；非双方调用 revert；resolve 后所有事件正确 emit |
| 不做 | 升级（如 PUSH0 优化） |

### T-160：合约部署脚本 + Sepolia 部署配置

| 字段 | 内容 |
|---|---|
| 标题 | 部署脚本 + Sepolia 链 env + 4 个测试用例 |
| Blocked by | T-150 |
| 状态 | `[ ]` |
| 时间 | 0.5 人天 |
| 交付 | `script/DeployEscrow.s.sol`：从 env 读 platformAdmin 地址、USDT 地址；部署后写部署地址到 `packages/contracts/broadcast/deployments.json`；`.env.example` 列出需要的 vars；`forge test` 加一组完整 happy-path test（digital + physical + dispute + 超时） |
| 验收 | `forge test` 全过；`forge script script/DeployEscrow.s.sol --rpc-url $RPC_URL --broadcast --private-key $PK` 在 Sepolia 上部署成功；前端能读到合约地址 |
| 不做 | 主网部署 |

═══════════════════════════════════════════════

## 3. 后端层（5 张）

> **路径**：`packages/api/`
> **约束**：Node.js + TS + Fastify + Postgres + S3（不发邮件 = 用 console.log 兜底，phase 2 接 Resend）

### T-200：Fastify 骨架 + Postgres 迁移 + `/health`

| 字段 | 内容 |
|---|---|
| 标题 | Fastify 项目骨架 + Postgres + 基础 migration |
| Blocked by | T-000 |
| 状态 | `[ ]` |
| 时间 | 0.7 人天 |
| 交付 | Fastify server（port 3001）、`/health` 返回 200；`db/migrate/` 跑通 users / listings / orders / disputes 四张表；Dockerfile + docker-compose（postgres 服务） |
| 验收 | `docker-compose up` 起 Postgres；`pnpm db:migrate` 出表；`curl /health` = 200 OK |
| 不做 | auth / listings CRUD |

### T-210：Auth — 钱包签名 + 邮箱验证

| 字段 | 内容 |
|---|---|
| 标题 | 钱包 nonce 签名登录 + 邮箱 magic link 登录 |
| Blocked by | T-200 |
| 状态 | `[ ]` |
| 时间 | 1.2 人天 |
| 交付 | `auth/wallet/`：GET `/auth/wallet/nonce` 返回 nonce，POST `/auth/wallet/verify` 校验签名 → JWT；`auth/email/`：POST 发送 magic link（console.log 链接），GET 校验 token → JWT；`auth/middleware.ts` 解 JWT 取 userId |
| 验收 | 测试：钱包登录 happy path；错签名 → 401；magic link 一次性；过期 token → 401 |
| 不做 | OAuth / 多设备 |

### T-220：Listings CRUD + Profile

| 字段 | 内容 |
|---|---|
| 标题 | 商品发布 / 列表 / 详情 / 编辑 / 下架 + 用户 Profile（display_name + email） |
| Blocked by | T-210 |
| 状态 | `[ ]` |
| 时间 | 1.2 人天（+0.2 含 profile 编辑） |
| 交付 | `listings/`：POST 创建（需登录，title / description / price_usdt / is_digital / 可选 image_url / 可选 file_key）；GET `/listings` 列表（分页、按 created/price 排序、按 is_digital 过滤）；GET `/listings/:id` 详情；PATCH 编辑（仅 seller）；DELETE 下架。`profile/`：GET `/me` 返回当前用户（wallet / email / display_name / created_at）；PATCH `/me` 更新 display_name（长度 1-30 字符）+ email（验证 magic link 才落地） |
| 验收 | 测试：商品创建 + 列表 + 详情 + 编辑 + 下架 happy path；非 seller 编辑 → 403；profile 更新 display_name 后立即生效，邮箱更新需点 magic link |
| 不做 | 搜索 / 类目 / 推荐 / 头像 |

### T-230：S3 文件托管（数字商品）

| 字段 | 内容 |
|---|---|
| 标题 | S3 presigned upload + 受控 download URL |
| Blocked by | T-220 |
| 状态 | `[ ]` |
| 时间 | 0.7 人天 |
| 交付 | `files/`：POST `/files/upload-url` 返回 presigned PUT URL（key = `digital/<listingId>/<fileId>`，订单关联固定文件版本，限定 content-type / 大小）；GET `/files/:orderId/download` 必须验证订单买家身份；授权状态待 D1 决定后返回短时 presigned GET URL；本地 dev 用 MinIO（S3 兼容） |
| 验收 | 测试：上传 + 下载 happy path；非授权用户或不满足 D1 授权状态时 GET download → 403 |
| 不做 | 多文件 / 视频转码 / 病毒扫描 |

### T-240：订单 + 链上事件监听

| 字段 | 内容 |
|---|---|
| 标题 | 订单状态机 + Viem watchContractEvent 跟随链上状态 |
| Blocked by | T-160, T-220 |
| 状态 | `[ ]` |
| 时间 | 1.5 人天 |
| 交付 | `orders/`：POST `/orders` 创建（listing 必须 active，buyer 登录；返回订单 payload + **前端 Wagmi 直发的 calldata**）；GET `/orders` 我的订单列表（买/卖过滤），GET `/orders/:id`；`chain/listener.ts`：用 Viem watchContractEvent 监听 `OrderFunded/Delivered/Released/Refunded/Disputed/Resolved`，落库；启动时通过 `eth_getLogs` 回放最近 1000 block 处理断连。**MVP 不引入 server relayer**——避免新增一个"私钥集中点"风险（docs §09 §1 私钥泄露 P0）；buyer 用钱包自付 Sepolia test ETH 作 gas；这是 spec §0 假设的连锁决定 |
| 验收 | 测试：下单 → 链上 fund → 后端收到事件 → DB 更新 state；超时订单被前端识别 |
| 不做 | 自动 markDelivered（卖家手动）；退款 / 部分退款 |

═══════════════════════════════════════════════

## 4. 前端层（4 张）

> **路径**：`packages/web/`
> **约束**：Next.js 14 App Router + TS + shadcn/ui + Wagmi v2 + WalletConnect AppKit

### T-300：Web 骨架 + 钱包连接 + 邮箱登录

| 字段 | 内容 |
|---|---|
| 标题 | Next.js 项目 + 钱包 / 邮箱登录 + 全局 auth context |
| Blocked by | T-000, T-210 |
| 状态 | `[ ]` |
| 时间 | 1 人天 |
| 交付 | Next.js App Router 工程，`/auth/wallet` 钱包签名流程、`/auth/email` magic link 流程；`useAuth()` Hook 持有 JWT + 当前用户；layout 中顶部 nav 有"登录 / 我的 / 上架"按钮 |
| 验收 | E2E 流程：未登录访问 `/listings/new` → 重定向到登录 → 钱包连接 → 跳回 → 可访问 |
| 不做 | 商品列表 / 上架表单 |

### T-310：公开商品列表 + 详情

| 字段 | 内容 |
|---|---|
| 标题 | `/` 列表页 + `/listings/[id]` 详情页 |
| Blocked by | T-220, T-300 |
| 状态 | `[ ]` |
| 时间 | 1 人天 |
| 交付 | 列表：分页、卡片（图片 / 标题 / 价格 / is_digital 角标 / 卖家短名）；详情：图片轮播 / 描述 / 卖家公开信息（展示名 + 钱包前 4 后 4 + 完成订单数）/ "购买"按钮（未登录禁用） |
| 验收 | Playwright：访问 `/` 看到列表；点击进入详情；详情页 SSR |
| 不做 | 搜索 / 评价 / 多语言 |

### T-320：上架表单 + 我的商品

| 字段 | 内容 |
|---|---|
| 标题 | `/listings/new` 上架表单 + `/me/listings` 我的商品 |
| Blocked by | T-220, T-300 |
| 状态 | `[ ]` |
| 时间 | 1 人天 |
| 交付 | 上架表单：React Hook Form + Zod 校验（图床用后端 S3 文件上传临时通道、或外链）/ is_digital 单选触发文件上传字段；提交后跳到我的商品页；我的商品页：表格 + 状态 + 编辑 / 下架 |
| 验收 | E2E：登录 → 上架数字商品（上传文件） → 列表页能看到 |
| 不做 | 富文本编辑器 / 多图 |

### T-330：订单详情 + 链上交互

| 字段 | 内容 |
|---|---|
| 标题 | `/orders/[id]` 订单页 + 链上交易发起 + Wagmi hooks |
| Blocked by | T-240, T-310 |
| 状态 | `[ ]` |
| 时间 | 1.5 人天 |
| 交付 | 订单详情：状态机可视化（badge + 时间线）/ 数字商品下载链接（按 D1 定义的授权状态启用）/ 实物买家"确认收货"按钮（call `confirmReceived`）/ 卖家"标记已交付"按钮（实物发货后 / 数字上传完成后 call `markDelivered`）/ 发起资金 call `fund`（使用 Wagmi `useWriteContract` + `useWaitForTransactionReceipt`）/ 显示 explorer 链接 |
| 验收 | E2E：买家下单 → 钱包弹窗 → 链上 confirm → 链上事件监听更新前端状态 |
| 不做 | dispute 前端（仅 T-400 admin） |

═══════════════════════════════════════════════

## 5. Admin（1 张）

### T-400：Admin 控制台 — 争议仲裁

| 字段 | 内容 |
|---|---|
| 标题 | `/admin/disputes` 仲裁控制台 |
| Blocked by | T-240, T-330 |
| 状态 | `[ ]` |
| 时间 | 1 人天 |
| 交付 | `/admin/login` 邮箱白名单（硬编码 1-2 个 admin email env var）；`/admin/disputes` 列出所有 DISPUTED 订单；点进看双方提交证据（文字 + 图片 URL）；按钮"判给买家" / "判给卖家" → 调合约 resolve |
| 验收 | E2E：admin 登录 → 看到列表 → 点 dispute → 选解决 → 链上事件 → DB 更新 |
| 不做 | admin 审计日志 / 多 admin / 通知商家 |

═══════════════════════════════════════════════

## 6. 部署 & 收尾（2 张）

### T-500：Vercel + VPS 部署 + 域名 + 监控最小集合

| 字段 | 内容 |
|---|---|
| 标题 | 前端上 Vercel + 后端上 VPS + 监控 |
| Blocked by | T-400 |
| 状态 | `[ ]` |
| 时间 | 0.7 人天 |
| 交付 | 前端：Vercel 自动 deploy；后端：PM2 + nginx + Let's Encrypt（假设有一个域名 docs.c2c.example.com 占位）；monitor：UptimeRobot 探针 `/health` + /api/orders 抽检合约 listener 是否存活；关键 env 在 `.env.example` |
| 验收 | 域名能访问；Sentry 或 console-only 日志可用 |
| 不做 | K8s / 多区 / 备份（Phase 2+） |

### T-501：E2E smoke 全链路验证

| 字段 | 内容 |
|---|---|
| 标题 | Playwright 全链路 smoke test + README |
| Blocked by | T-500 |
| 状态 | `[ ]` |
| 时间 | 0.5 人天 |
| 交付 | Playwright 1 个测试：seller 上架数字商品 → buyer 浏览 → fund → seller markDelivered → autoRelease 触发（这里跳过时间用 hardhat 后门 / 直接调合约 setState 不行；改：直接走链上，**只验证 7d 之前的 funded 状态正确** + 1 个 dispute path）；README 写清启动步骤 + 环境变量 + 截图 |
| 验收 | `pnpm test:e2e` 本地通过；README 完整 |
| 不做 | 性能 / 压测 / 端到端 SLA |

═══════════════════════════════════════════════

## 7. 历史依赖（修正）

以各票 `Blocked by` 为依据，不能再把全部 20 张票画成一条关键路径：

- T-000 后，合约 T-100→…→T-160 与后端 T-200→T-210→T-220 可以并行。
- T-300 依赖 T-000、T-210，不依赖完整合约链或 T-240。
- T-310 与 T-320 均依赖 T-220、T-300，彼此不互相阻塞。
- T-230 依赖 T-220；T-240 依赖 T-160、T-220。
- T-330 依赖 T-240、T-310；上架文件联动还需复核 T-320 与 T-230 的接口依赖。
- T-400→T-500→T-501 为当前历史收尾顺序；部署准备与测试编写是否提前应在新计划中明确。

不存在“只有 T-100 与 T-200 能并行”的结构性限制。新工期须按重新估算后的依赖图计算。

## 8. 历史工作量复核

| 模块 | 票数 | 按逐票时间相加（人天） |
|---|---:|---:|
| 脚手架 | 1 | 0.5 |
| 合约 | 7 | 5.0 |
| 后端 | 5 | 5.3 |
| 前端 | 4 | 4.5 |
| Admin | 1 | 1.0 |
| 部署/收尾 | 2 | 1.2 |
| 合计 | 20 | **17.5** |

按每人月 20 工作日，这约为 0.875 人月。原汇总“19.1 人天 ≈ 6.5 人月”在加总和单位换算上均错误。逐票估时也未经实施验证，不能视为可行承诺；与 Spec 模块估算不一致，恢复项目时必须重估。

## 9. 后续处理

历史工单保留用于追溯，状态仍为未实施。当前只推进前端演示版；测试网阶段需先解决 [problem.md](problem.md) 与 [复核记录](../review-corrections.md) 中的问题，再生成新的可执行工单。
