# Problem Log — Spec & Ticket 待 Review 项

> **用途**：记录 crypto-c2c MVP spec / tickets 里需要用户拍板或技术修复的问题。
> **状态机**：`[ ]` 待拍板 · `[~]` 讨论中 · `[x]` 已解决（含处置方式） · `[!]` 已废弃
> **来源**：2026-07-31 review `mvp-spec.md` + `mvp-tickets.md` 派生
> **关联文档**：[mvp-spec.md](./mvp-spec.md) / [mvp-tickets.md](./mvp-tickets.md) / [README.md](../README.md)

---

## 0. Tracker

| ID | 等级 | 一句话 | 状态 |
|---|---|---|---|
| P1 | 🔴 P0 风险 | Safe 2-of-2 = 单签延迟，未消除单点失效 | `[ ]` |
| P2 | 🔴 业务规则 | 数字商品 7d 未交付 → 退买家还是 release 卖家 | `[ ]` |
| P3 | 🟡 边界 case | 数字商品已 markDelivered 但买家未确认 → 超时归谁 | `[ ]` |
| P4 | 🔴 ticket 矛盾 | T-230 S3 key 用 `digital/<orderId>` 但 orderId 在 fund 后才有 | `[ ]` |
| P5 | 🟡 安全模型 | 后端托管数字商品文件：能否单方面给买家发文件 | `[ ]` |
| P6 | 🟡 范围 | ETH 后期接入：MVP 写死还是参数化 | `[ ]` |
| P7 | 🟡 onboarding | buyer 没 Sepolia ETH 时如何下单 | `[ ]` |
| P8 | 🟡 测试覆盖 | T-501 E2E 不测超时路径，与 T-130/140 核心逻辑矛盾 | `[ ]` |
| P9 | 🟡 admin 安全 | admin 邮箱白名单无二因素 = 单密码泄露 = 钱失控 | `[ ]` |
| P10 | 🟡 前端稳定性 | T-300 Next.js 14 App Router + Wagmi v2 SSR hydration 风险 | `[ ]` |

---

## 1. Blocker（🔴 必须先解决，否则 ticket 开工即返工）

### P1 — Safe 2-of-2 不是"多签消除单点"

**位置**：[mvp-spec.md §0 A5](./mvp-spec.md) + §7.1.2

**问题**：
- spec §0 A5 默认 "Gnosis Safe 2-of-3（你 + 合作方钱包 + 冷钱包）"；找不到合作方退到 2-of-2（你 + 离线冷钱包）。
- spec §7.1.2 写"消除 P0 单点失效"。
- **矛盾**：2-of-2 = 你签 + 冷钱包签。冷钱包是离线签名工具，不是另一个"人"。你只是把一个密钥拆成两半持有，本质是 **1-of-1 的延迟签名**，没消除 P0 单点。

**三种处置方案**：

| 方案 | 含义 | P0 是否消除 |
|---|---|---|
| A | 硬性要求：必须有 1 个真人合作方持第 2 把独立密钥（投资人 / 联创 / 律师 / 信任的朋友） | ✅ 真消除 |
| B | 软目标：能找到合作方就 2-of-3，找不到就 2-of-2 临时 | ❌ 实际只跑 B'（2-of-2） |
| C | 单签 + 硬件钱包自托管（承认现状，不再声称"多签消除 P0"） | ❌ 不消除，但描述诚实 |

**当前 spec 实际是 B**——但 README §风险列表没说 B 没消除单点。

**待决策**：
- [ ] 选 A / B / C
- [ ] 选 B/C 时需在 spec §7.1.2 显式标红"未消除 P0"
- [ ] 选 A 时需在 mvp-tickets.md T-160 后追加 T-170：合作方密钥持有流程 + 应急恢复演练

---

### P2 — 数字商品 7d 未交付，业务规则相反

**位置**：[mvp-spec.md §3](./mvp-spec.md) + [mvp-tickets.md T-130](./mvp-tickets.md)

**问题**：
- spec §3 业务故事写："作为 买家（数字商品），我想 在 7 天后未确认的情况下**自动释放**（数字商品）..." → 读起来是"超时退买家"（买家没拿到货）
- T-130 实现写："`state == FUNDED && now > fundedAt + 7d` → 自动 **release 给 seller**" → 这是"超时钱归卖家"

**两个意思完全相反**：

| 解读 | 含义 | 偏袒 |
|---|---|---|
| 退款 | 数字 7d 卖家未交付 → 钱退买家 | 买家 |
| 释放 | 数字 7d 卖家未交付 → 钱给卖家 | 卖家 |

**待决策（必须你拍）**：

- [ ] **方案 A**（推荐）：数字商品 7d 卖家未交付 → **refund 买家**（保护买家，符合 spec §3 字面）
- [ ] **方案 B**：数字商品 7d 卖家未交付 → **release 卖家**（保护小卖家，但 spec §3 文字要改）

**决策影响**：

| 方案 | 改动的文件 | 改动行数 |
|---|---|---|
| A | T-130 实现段 + 验收段；spec §3 业务故事不动 | ~5 行 |
| B | spec §3 业务故事改字；T-130 实现段 + 验收段确认 | ~10 行 |

---

### P4 — T-230 S3 key 命名规则与流程矛盾

**位置**：[mvp-tickets.md T-220 + T-230](./mvp-tickets.md)

**问题**：
- T-230 写 `key = digital/<orderId>`，限定 content-type / 大小
- orderId 在 T-240 里 fund 之后才有
- T-220 创建 listing 时 listing 还没绑 orderId
- **真矛盾**：买家浏览 listing → seller 创建 listing 时，数字商品文件传不上去（key 没生成）

**待决策**：

- [ ] **方案 A**（推荐）：key 改成 `digital/<listingId>`（listing 创建时就有 ID），订单 RELEASED 后该 listing 的文件 = 该订单的下载源。需 T-230 改 + T-240 增加 `listings.file_storage_key → orders` 关联
- [ ] **方案 B**：key 改成 `digital/<stubId>`（卖家先上传到 stub，再创建 listing 时绑定 stubId），需 T-230 + T-220 都改
- [ ] **方案 C**：保留 orderId 命名，强制要求"先下单 → 再上传"（改变 UX 流程）

---

## 2. Yellow（🟡 不阻塞开工，但建议 T-000 启动前想清楚）

### P3 — 数字商品 markDelivered 后买家未确认，超时归谁？

**位置**：[mvp-tickets.md T-130 + T-140](./mvp-tickets.md)

**问题**：
- T-130 写的 `autoRelease` 路径只看 `state == FUNDED`，不看是否 `DELIVERED`
- 数字商品 seller markDelivered 后 → state = DELIVERED，T-130 的分支不覆盖
- T-140 物理路径也只看 `state == FUNDED`
- 实际场景：数字商品卖家已上传文件（state=DELIVERED），买家 7 天没点确认 → 钱归谁？

**待决策**：

- [ ] **方案 A**（推荐）：state=DELIVERED + 超 7d → release 给卖家（卖家已履行，懒惰买家自动结算）
- [ ] **方案 B**：state=DELIVERED + 超 7d → refund 给买家（保守，但卖家可能故意上传垃圾文件后等超时获利）
- [ ] 需同步改 T-130 的 `autoRelease` 分支判断条件，加 `state == DELIVERED` 一支

---

### P5 — 后端代为托管数字商品文件，安全模型未明

**位置**：[mvp-spec.md §0 A6](./mvp-spec.md) + T-230

**问题**：
- spec §0 A6 默认"后端代为托管文件，escrow 释放后开放下载链接"
- 没写：后端能否单方面给买家发文件？文件存多久？能否拒绝发？

**待决策**：

- [ ] 后端运营方能否绕过 escrow 直接给买家发文件？（建议：**不能**——任何发文件必须伴随 state=RELEASED）
- [ ] RELEASED 后文件保留多久？（建议：**永久**——MVP 简单粗暴；Phase 2 加 S3 lifecycle 清理）
- [ ] 后端能否拒绝发文件？（建议：**能**——但 dispute 是买家救济路径，refund 是另一救济）

---

### P6 — ETH 后期接入，MVP 写死还是参数化

**位置**：[mvp-spec.md §0 A2](./mvp-spec.md)

**问题**：
- MVP 只接 USDT；spec §0 A2 写"+1 周工作量"加 ETH
- 写死 = Phase 2 重构合约 + 重测
- 参数化 = MVP 多 0.5 人天（合约加 native 收币分支），但 Phase 2 改起来轻

**待决策**：

- [ ] **方案 A**（推荐）：MVP 写死 USDT-only，Phase 2 重构（重构 + 测试 < 参数化 + 多测试面）
- [ ] **方案 B**：MVP 参数化（合约 native + ERC-20 双收币），Phase 2 改起来轻

---

### P7 — buyer 没 Sepolia ETH 时如何下单

**位置**：[mvp-tickets.md T-240](./mvp-tickets.md)

**问题**：
- T-240 写"buyer 用钱包自付 Sepolia test ETH 作 gas"
- 真实新用户大概率没有 Sepolia ETH
- spec 已砍 server relayer（"避免私钥集中点"）
- 真 onboarding 阻断：一个没 Sepolia ETH 的用户连第一单都下不了

**待决策**：

- [ ] **方案 A**（推荐）：README + T-320 上架页顶部一次性提示"buyer 自备 Sepolia ETH（https://sepoliafaucet.com）"。零工程成本
- [ ] **方案 B**：平台 relayer 替买家付 gas（撤销 §0 T-240 的"砍 relayer"决定，新增加私钥管理 ticket）
- [ ] **方案 C**：合约 ERC-20 paymaster（复杂度爆炸，不推荐 MVP）

---

### P8 — T-501 E2E 不测超时路径，与核心业务逻辑矛盾

**位置**：[mvp-tickets.md T-501](./mvp-tickets.md)

**问题**：
- T-130 / T-140 的超时释放 / 超时退款是核心业务
- T-501 写"只验证 7d 之前的 funded 状态正确"——E2E 不测超时
- T-501 文字本身自相矛盾：先提 hardhat 后门又说"hardhat 后门不行"

**待决策**：

- [ ] **方案 A**（推荐）：T-501 加 E2E 用 Anvil fork 主网状态 + `vm.warp(block.timestamp + 8 days)` 跳时间。验证超时 release + 超时 refund。+0.2 人天
- [ ] **方案 B**：保留 T-501 现状，超时只靠合约 unit test 兜底（spec §5 已要求 100% 状态转换覆盖）

---

### P9 — admin 邮箱白名单无二因素

**位置**：[mvp-tickets.md T-400](./mvp-tickets.md)

**问题**：
- T-400 写"邮箱白名单（硬编码 1-2 个 admin email env var）"
- 后端代码直接信任这个邮箱登录的人是 admin
- admin 控制台 = 仲裁争议 = 决定钱归谁
- 一个 admin 邮箱密码泄露 = 平台钱失控

**待决策**：

- [ ] MVP 接受现状（明确"admin 邮箱 = 专用，不作他用"，README 警告）
- [ ] MVP 加二次验证（邮件 OTP / TOTP）—— +0.3 人天
- [ ] MVP 加 IP 白名单 + 单独子域名（admin.c2c.example.com）—— 0.5 人天

---

### P10 — Next.js 14 App Router + Wagmi v2 SSR hydration 风险

**位置**：[mvp-tickets.md T-300](./mvp-tickets.md)

**问题**：
- T-300 用 Next.js 14 App Router + Wagmi v2 + WalletConnect AppKit
- 2025 年有过 Wagmi v2 在 App Router 下 SSR hydration 报错的问题（`window is not defined`、`Hydration failed`）
- T-300 验收没写"SSR 兼容性验证"

**待决策**：

- [ ] **方案 A**（推荐）：T-300 验收加"Playwright smoke：未登录访问 / SSR 渲染不报错 / 控制台 0 错误"
- [ ] **方案 B**：退到 Next.js 14 Pages Router（牺牲 RSC，省 SSR 调试时间）

---

## 3. 已废弃 / 转入主流程

（暂无）

---

## 4. 待办元规则

- 每条问题决策后，状态从 `[ ]` 改成 `[x]` 并加一行"处置方式"摘要
- 处置方式必须引用具体文件 + 行号（如 `mvp-spec.md §0 A5`）
- 决策不能只放在 problem.md，必须同步改源文档（spec / tickets），否则决策 = 空气
- 新问题追加到 §0 Tracker，按等级升序排列