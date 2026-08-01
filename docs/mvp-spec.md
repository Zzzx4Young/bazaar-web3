# CryptoC2C MVP — 缩减版 A Spec

> **状态**：v0.1 草稿，等待 review。后续每改动一轮，提一次 changelog。
> **生成日期**：2026-07-28
> **来源**：由 `/to-spec` 从 docs §01–§10 综合 + 用户在 2026-07-28 grill 第 4–6 轮作出的硬约束
> **作者说明**：本文档是产品/工程规格，不是法律意见。实物物品的跨境责任、KYC/AML 监管要求按 docs §03 标准延后处理，**MVP 阶段不解决**。

---

## 0. 我替你做的假设（请先 review 这节，再读后面）

下面这些是 MVP spec 必须锁定的参数，但你没明确拍板。我在 spec 里替你选了"最简可用"的默认值。**任何一条不同意，比后面所有内容都重要**：

| # | 假设 | 默认值 | 选它的理由 | 不选的后果 |
|---|---|---|---|---|
| A1 | 平台费率 | **1%** | docs §08 默认 1–1.5%，取下限 | 1.5% 更稳但对小订单重 |
| A2 | 支持币种 | **USDT 主，ETH 暂不接** | ETH 计价波动大，gas 贵，对二手物品不值 | ETH 后期加 ~1 周工作量 |
| A3 | 链 | **Sepolia 测试网起步** | 你 Q3 说"审计后续再深入"，不上主网就不必 $20-50K 审计 | 真要上主网需审计预算 |
| A4 | KYC | **邮箱验证** | 你说"用户可用是网上的任何人"——MVP 阶段零摩擦 | 接入 Sumsub 需要 $1-3K/月 + 工程 |
| A5 | 仲裁人 | **Gnosis Safe 2-of-3（你 + 合作方钱包 + 冷钱包）** | 单签 = 你钱包被偷所有争议钱被偷；2-of-3 多签消除 P0 单点失效。合作方找不到就先 2-of-2（你 + 离线冷钱包） | 多签需要 0.3 人天集成 + 1 个合作方或硬件钱包；不上多签的 P0 风险 docs §09 §1 已写 |
| A6 | 数字商品交付 | **后端代为托管文件，escrow 释放后开放下载链接** | 完全链上文件交付对 web3 MVP 太重 | 链上 IPFS 留 Phase 2+ |
| A7 | 实物交付 | **卖家自己发货；买家确认收货触发释放** | 你 Q1 说"物流客户自己负责" | 物流追踪 / 仲裁复杂化 → Phase 2 |
| A8 | 用户登录 | **钱包连接 + 邮箱**（任一） | 钱包用户有 web3 native，邮箱用户有散户 | 仅钱包 = 流失 80% 散户 |
| A9 | 数据存储 | **Postgres + S3**（最小） | docs §04 砍掉 ES/Kafka/Timescale | 后面扩 |
| A10 | 部署 | **Vercel + 单一 VPS（自跑 Postgres + 后端）** | 2 人运维能力 ≤ 1 个 VPS | K8s / 多区留给融资后 |

**这些里有任何一条不对，请先告诉我。我不锁死，按你拍的来重写 spec。**

---

## 1. Problem Statement（用户面对的问题）

> 全球有数百万加密货币用户，他们的实际痛点不是"持币"，而是"花币"。
> 普通人想用 USDT 买二手商品（实物或数字），目前**没有任何可信的 C2C 渠道**——闲鱼/eBay 不支持加密支付，P2P OTC 只服务法币兑换，Dan.com 服务域名但通用度不够。

---

## 2. Solution（从用户视角）

> 一个 web 网站，卖家自己上传商品（标题、描述、价格、USDT 计价），买家用钱包连接后浏览购买。资金通过链上 escrow 锁进智能合约：买家收货后自动释放给卖家；如发生争议，平台仲裁。

### 2.1 关键非目标（MVP **不做**的）

| 不做 | 为什么 |
|---|---|
| KYC（真实身份） | 邮箱验证已是 MVP 上限；Sumsub 延后 |
| 物流追踪 / 物流 API | 卖家自己发货 + 买家手动确认收货 |
| 信用分 / 评价 / 商家认证 | Phase 2 |
| 移动 App / PWA | 文档要求纯 Web |
| 拍卖 / 多语言切换 / i18n | Phase 2 |
| 多链 | Sepolia 测试网单一 |
| 自托管的私钥管理 / 托管钱包 | 仅 WalletConnect 外部钱包 |
| 法币入金 / 出金 | 全程 USDT |
| 邀请奖励 / 推广系统 | 你 Q2 说"推广暂不考虑" |
| 退款 / 部分退款 / Coupon | MVP 只支持全额释放或全额退款 |

---

## 3. User Stories（每条都是 Phase 1 单个 ticket 可完成的）

```
作为 卖家（钱包登录），我想 上架一个商品（标题/描述/价格/USDT 计价），这样 别人可以买我的东西。

作为 卖家，我想 上传一张商品图片，这样 买家能看到长什么样。

作为 卖家，我想 查看我的所有商品和它们的浏览/购买情况，这样 我知道卖得怎么样。

作为 卖家（数字商品），我想 上传一个文件作为交付物，这样 escrow 释放后买家能下载。

作为 买家（钱包登录），我想 浏览商品列表（按时间/价格排序），这样 我能选我想买的。

作为 买家，我想 看到商品详情 + 卖家公开信息（钱包地址 + 上架数 + 完成订单数），这样 我能判断信不信任。

作为 买家，我想 钱包点击购买，USDT 自动进 escrow 合约，这样 卖家开始处理订单。

作为 买家（数字商品），我想 卖家标记"已交付"后能立刻下载文件 / 收到密钥，这样 我马上能用。

作为 买家（实物），我想 收到货后能点击"确认收货"，这样 escrow 释放 USDT 给卖家。

作为 买家或卖家，我想 在 7 天后未确认的情况下自动释放（数字商品）或自动超时取消（实物），
这样 我不需要永远卡着。

作为 争议方，我想 在订单异常时发邮件给平台仲裁，这样 真有问题能找人。

作为 平台仲裁，我想 在后台看到所有争议订单 + 双方提交的证据（文字 + 图片），这样 我能判给谁。

作为 平台仲裁，我想 调用智能合约的 release / refund 函数，这样 钱按我的判断走。

作为 未登录访客，我想 浏览商品列表（不显示卖家钱包），这样 我看看有没有想要的。

作为 已注册用户，我想 修改我的展示名（默认是钱包地址前 4 后 4），这样 别人更认识我。

作为 已注册用户，我想 修改我的联系邮箱，这样 magic link 还能收到通知。
```

> **这些故事是完整覆盖 MVP 用户旅程的。下游 `/to-tickets` 会从这张表派生，不再加故事**。

---

## 4. Implementation Decisions（已实施的具体决定）

### 4.1 合约（必须按 §05 写，但简化掉 KYC + 多签）

> **Solidity 单一合约 `Escrow.sol`**（不是 §05 的工厂模式——MVP 阶段一个池就够了，省一层）。

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Escrow is Ownable {
    using SafeERC20 for IERC20;

    enum State { AWAITING_PAYMENT, FUNDED, DELIVERED, RELEASED, REFUNDED, DISPUTED }

    struct Order {
        address buyer;
        address payable seller;
        uint256 amount;
        State state;
        uint64 createdAt;
        uint64 fundedAt;
        uint64 deliveredAt;
        bool isDigital;            // digital = 自动 7d 释放；physical = 需买家确认
    }

    IERC20 public immutable usdt;

    uint256 public platformFeeBps = 100;  // 1%
    uint256 public constant AUTO_RELEASE_DELAY = 7 days;

    mapping(bytes32 => Order) public orders;
    mapping(address => uint256) public pendingFees;   // 默认累积到 owner（Safe）

    event OrderFunded(bytes32 indexed orderId, address buyer, uint256 amount);
    event Delivered(bytes32 indexed orderId);
    event Released(bytes32 indexed orderId, uint256 sellerAmount, uint256 fee);
    event Refunded(bytes32 indexed orderId, uint256 amount);
    event Disputed(bytes32 indexed orderId);
    event Resolved(bytes32 indexed orderId, bool releaseToSeller);
}
```

> **`owner = Safe 多签地址`**（部署时由 `Ownable(address initialOwner)` 传入，部署脚本里写 `SafeAddr`）。`resolve` 和 `withdrawFees` 都受 `onlyOwner` 保护——所以任何一次 dispute 仲裁 + fee 提取都必须经 Safe 2-of-3 / 2-of-2 多签签名。

**核心方法**：
- `fund(bytes32 orderId, address seller, bool isDigital)` — 买家批准 USDT 后调用，把钱锁进合约
- `markDelivered(bytes32 orderId)` — 卖家调用（实物发货后 / 数字交付完成）
- `confirmReceived(bytes32 orderId)` — 买家调用（实物收货后）
- `dispute(bytes32 orderId)` — 任一方调用
- `resolve(bytes32 orderId, bool releaseToSeller)` — **`onlyOwner`**，由 Safe 多签签名后调用
- `autoRelease()` — anyone 调用，触发超时订单（数字 7d + 卖家已交付 / 实物 14d + 资金已锁定后无动作）
- `withdrawFees()` — **`onlyOwner`**，Safe 多签触发提取累积的 platform fee

**fee 处理**：释放时扣 1%，累积到 `pendingFees[owner]`（即 Safe 地址），Safe 多签签名后 `withdrawFees()` 提取到 Safe 子账户。

**MVP 不做**：升级（不可变合约）、KYC 注册表、工厂模式（一个池 = 一个合约，地址用环境变量）。**MVP 已加**：Gnosis Safe 2-of-3 / 2-of-2 多签（见 §0 A5）——管理员是 Safe 合约地址，不再是 EOA。

### 4.2 后端（Node.js + TypeScript + Fastify，按 §06）

**模块**（最小集合，砍到 §04 的三分之一）：

```
src/
├── auth/           # 邮箱 + 钱包 nonce 签名校验
├── listings/       # CRUD + 搜索（先 LIKE，不上 ES）
├── orders/         # 状态机镜像（链上是 source of truth，DB 是索引）
├── deliveries/     # 数字商品文件 + 买家确认收货
├── disputes/       # 接收 + admin 控制台
├── files/          # S3 presigned upload / download（数字商品托管）
└── index.ts
```

**不做的模块**：IM（站内信用邮件替代）、通知（push/SMS 砍）、合规（制裁名单砍）、退款流程、Kafka/ES/ClickHouse。

**数据库 schema**（精简版）：

```sql
users (id, wallet_addr UNIQUE, email UNIQUE, display_name, created_at)
listings (id, seller_id, title, description, image_url, price_usdt,
          is_digital, file_storage_key NULL, status, created_at)
orders (id, listing_id, buyer_id, seller_id, chain_order_id BYTES32 UNIQUE,
        amount_usdt, state, is_digital, created_at, funded_at, delivered_at,
        resolved_at)
disputes (id, order_id, opened_by, reason, evidence_jsonb, status, admin_note)
```

**链上事件监听**：用 Viem 的 `watchContractEvent` 监听 `OrderFunded/Delivered/Released/Refunded`，落到 `orders.state`，DB 总是跟随链上状态；交易失败回滚 DB 状态。

### 4.3 前端（Next.js 14 App Router）

**路由**：
```
/                          # 公开商品列表
/listings/[id]             # 商品详情
/listings/new              # 上架（需登录）
/orders                    # 我的订单（买/卖两栏）
/orders/[id]               # 订单详情 + 操作
/admin/disputes            # 仲裁控制台
/admin/login               # 简单邮箱登录（仅管理员可达）
```

**关键组件**（按 docs §06 的 shadcn/ui + Tailwind + Wagmi v2）：
- 钱包连接：`Reown AppKit` + Wagmi 适配器
- 表单：`React Hook Form + Zod`
- 数据获取：`TanStack Query`
- 链上交互：`Wagmi useWriteContract + useWaitForTransactionReceipt`

**MVP 不做的**：i18n、图表、暗色模式（用 shadcn 默认就行）、SEO（robots 允许就行）。

### 4.4 测试 / 部署 / 监控（最小可用）

- **合约测试**：Hardhat + 100% 覆盖放行（不是 100% 行覆盖，是"每个状态转换有正面 + 负面 test"）
- **后端测试**：单测 + 一组 integration test（订单完整 happy path + dispute）
- **前端**：暂不写单测，靠 contract test 兜底 + Playwright 一组 smoke test
- **部署**：
  - 前端：Vercel
  - 后端：1 台 VPS（4 vCPU / 8 GB，~ $40/月）
  - 链：Sepolia（免费）+ 主网的 USDT 测试版
  - 文件：S3 标准 IA（每月估 < $5）
- **监控**：Vercel + VPS 自跑 Grafana（不接 Datadog，省钱）

---

## 5. Testing Decisions（什么算"测过"）

1. **合约 test 必须 100% 覆盖每个状态转换**：
   - AWAITING_PAYMENT → FUNDED：买家调 fund，钱进合约
   - FUNDED → DELIVERED：实物（卖家发货后）/ 数字（卖家上传完成）
   - DELIVERED → RELEASED：数字自动 / 实物买家确认 / 超时
   - FUNDED → REFUNDED：争议解决判定给买家 / 数字未交付 7d 自动取消
   - 任意状态 → DISPUTED：双方任意调用后 admin 解决
   - 付 fee 准确（1%）
   - 重新进入非法状态 / 重复操作必须 revert
2. **后端 integration test**：1 个 happy path（买实物 + 收货释放）+ 1 个 dispute path（争议 + admin 解决）
3. **合约审计**：**MVP 不做**（用户 Q3 答"后续再深入"）。文档明确：MVP 跑测试网 + 不接受主网真实资产 = 没审计也能跑。
4. **可观测**：每笔链上 tx 在前端能看到 explorer 链接；后端日志打到 stdout `JSON{ts, level, msg, ctx}`。

---

## 6. Out of Scope（明确不做的）

| 类别 | 项目 |
|---|---|
| 合规 | Sumsub/Onfido KYC、OFAC 名单检查、法币出入金、跨境税务 |
| 物流 | 任何物流集成、地址验证、签收回执 |
| 信任机制 | 信用分、评价、商家认证、Stripe 风格的买家保护 |
| 链 | 多链（Arbitrum/Base/TRC20）、Layer 2、跨链桥 |
| 终端 | iOS App、Android App、PWA、桌面 |
| 经济 | 充值优惠、推荐奖励、Coupon 码、批量上架 |
| 管理 | 多 admin、role 权限、CMS、商品审核 |
| 用户体验 | 暗色模式切换、i18n、推送、邮件模板美工 |

---

## 7. Further Notes

### 7.1 风险（不操作层面，**已知**会被问到，先在这里答）

1. **审计缺失 = 主网上线就是赌博**：MVP 在测试网跑不需要审计；上主网需要。先不上主网是对的。
2. **平台管理员是 Safe 多签（P0 风险已消除）**：Gnosis Safe 2-of-3（合作方钱包找不到退到 2-of-2 含冷钱包）。任何 dispute resolve 必须 ≥2 人签名；丢失任一钱包不丢钱。
3. **没有 KYC = 法律暴露**：docs §03 是逐步加 KYC，MVP 用邮箱已是大让步，**真上主网前必须找当地律所**。
4. **平台 fee 只有 1%**：低价位二手物品 + 测试网，0 现金回流是事实；目标是**学习**不是赚钱。

### 7.2 Phase 2 触发条件（任一条达成都该讨论下一步）

- 30 天有 ≥ 20 个真实订单（不论总额）
- 任何一条用户反馈"想买但买不到"或"想卖但卖不出"
- 监管有任何动作（哪怕是新闻）
- 主动找到 1 个愿意付费 / 出资 / 合作的真实人

### 7.3 工作量（再次诚实说明）

| 模块 | 工作量估算 |
|---|---|
| 合约 + 测试（含 Safe 集成） | 1.2 人月（+0.2 加 Safe 部署 + 调用） |
| 后端 + DB + S3 + 邮件 | 1.5 人月 |
| 前端 Next.js + 钱包 + 表格 | 2 人月 |
| 部署 / CI / 域名 / 监控 | 0.3 人月 |
| Admin 控制台 + Safe 多签交互 | 0.6 人月（+0.1 Safe web flow） |
| buffer（修 bug / 重构 / 文档） | 0.5–1 人月 |
| **合计** | **~6.5–7.5 人月** |

**2 人并行估时（理想）**：

- 6.5 人月 / 2 人 = **~ 3.3 人月** ≈ 13–14 周
- 我辅助提效可砍 20–30% → **11–12 周**

**2 人串行估时（现实 / 2 人团队的常态）**：

- 关键路径含 20 张 ticket 中 14 张是单向链（依赖图 §7 显示）
- T-300 锁死 T-210 → 前端只能等后端 auth 完成后开始
- T-310/T-320/T-330 串行在 T-300 之后
- 现实并行只有 T-100 ↔ T-200（合约 vs 后端骨架），其他基本是一人干一人等
- 串行合计 ≈ **6.5 人月** × 2 人 ≈ **~26 周**（不含 buffer）

**取现实值 ≈ 14 周**（这是优化后的真实中位，假设 P1 阶段真并行 + 后续主路径顺利）。这是 MVP 不确定性最高的数字——你们两人是不是真能并行做完 T-100 ↔ T-200 这一段决定下限。

---

## 8. 下一步（spec 完成后）

按 `/to-tickets` 流程，会把上面 User Stories + Implementation Decisions 拆成 ~12-15 张工单，每张可在一个 fresh 上下文里完成。然后开 `/implement`。

但**先不动**——你要 review §0（10 条假设）是否同意。不同意任何一条就告诉我；全部同意，我们进 `/to-tickets`。
