# 04. 系统架构

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         客户端层(Client)                              │
├─────────────────────────────────────────────────────────────────────┤
│  Web App (Next.js)          iOS App (Swift)         Android App    │
│  - 商品浏览                  - 钱包连接              - 钱包连接     │
│  - KYC                       - 商品发布              - 商品发布     │
│  - 钱包连接(Wagmi)          - 链上交互              - 链上交互     │
│  - 链上交互(ethers)                                                  │
└─────────────────────────────────────────────────────────────────────┘
                                 ↕ HTTPS / WSS
┌─────────────────────────────────────────────────────────────────────┐
│                      API 网关层(API Gateway)                          │
├─────────────────────────────────────────────────────────────────────┤
│  Kong / AWS API Gateway                                            │
│  - 鉴权(JWT)                                                       │
│  - 限流(Rate Limiting)                                              │
│  - WAF(Web 应用防火墙)                                              │
│  - 日志审计                                                         │
└─────────────────────────────────────────────────────────────────────┘
                                 ↕
┌─────────────────────────────────────────────────────────────────────┐
│                      业务服务层(Business Services)                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │
│  │ 用户服务     │  │ 商品服务     │  │ 订单服务     │  │ 钱包服务  │  │
│  │ User Svc    │  │ Listing Svc │  │ Order Svc   │  │ Wallet   │  │
│  │ - KYC       │  │ - 发布       │  │ - 创建订单   │  │ - 链监听  │  │
│  │ - 登录      │  │ - 搜索       │  │ - 状态机     │  │ - nonce   │  │
│  │ - 资料      │  │ - 类目       │  │ - 仲裁       │  │ - 签名    │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └──────────┘  │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │
│  │ 消息服务     │  │ 通知服务     │  │ 合规服务     │  │ 文件服务  │  │
│  │ IM Svc      │  │ Notify Svc  │  │ Compliance  │  │ Storage  │  │
│  │ - 站内信    │  │ - 邮件       │  │ - KYC/AML   │  │ - 图片   │  │
│  │ - 实时通讯  │  │ - 推送       │  │ - 制裁名单   │  │ - 视频   │  │
│  │             │  │ - SMS       │  │ - 上报       │  │ - IPFS   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └──────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                 ↕
┌─────────────────────────────────────────────────────────────────────┐
│                        数据层(Data Layer)                              │
├─────────────────────────────────────────────────────────────────────┤
│  PostgreSQL      Redis           Elasticsearch     S3 / IPFS        │
│  (主数据)        (缓存/会话)     (搜索)            (文件)            │
│                                                                     │
│  TimescaleDB     Kafka           ClickHouse                          │
│  (时序/日志)     (消息队列)      (分析)                              │
└─────────────────────────────────────────────────────────────────────┘
                                 ↕
┌─────────────────────────────────────────────────────────────────────┐
│                       区块链层(Blockchain)                            │
├─────────────────────────────────────────────────────────────────────┤
│  Ethereum L1      Arbitrum / Optimism (L2)      Base                │
│  (主 escrow 合约) (高频交易)                     (Coinbase 生态)    │
│                                                                     │
│  TRON             TON             Solana                             │
│  (USDT-TRC20)     (TON 钱包)      (高频小额)                        │
│                                                                     │
│  第三方服务: Alchemy / Infura / QuickNode (RPC)                     │
│             WalletConnect (钱包连接)                                │
│             The Graph (链上数据索引)                                 │
└─────────────────────────────────────────────────────────────────────┘
                                 ↕
┌─────────────────────────────────────────────────────────────────────┐
│                      外部服务(External)                               │
├─────────────────────────────────────────────────────────────────────┤
│  KYC: Sumsub / Onfido                                               │
│  AML: Chainalysis / Elliptic                                        │
│  支付: WalletConnect / Coinbase Commerce (备选)                      │
│  物流: AfterShip / 17Track                                          │
│  邮件: SendGrid / Postmark                                          │
│  推送: Firebase / APNs                                              │
│  监控: Datadog / Sentry                                              │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. 模块详细设计

### 2.1 用户服务(User Service)

**职责**:
- 邮箱/钱包注册
- 邮箱验证
- KYC 流程编排
- 用户资料
- 信用分
- 制裁名单检查

**技术栈**:
- Node.js + TypeScript
- PostgreSQL(用户主数据)
- Redis(会话)
- JWT 鉴权
- 第三方 KYC API 集成

**数据模型**:
```sql
users (
  id UUID PK,
  email VARCHAR UNIQUE,
  password_hash VARCHAR,
  wallet_address VARCHAR UNIQUE,  -- 主要钱包
  kyc_status ENUM('none','pending','approved','rejected'),
  kyc_provider_id VARCHAR,  -- Sumsub applicant ID
  country_code CHAR(2),     -- 用户申报国家
  created_at TIMESTAMP,
  last_login_at TIMESTAMP
)

user_profiles (
  user_id UUID PK,
  display_name VARCHAR,
  bio TEXT,
  avatar_url VARCHAR,
  social_links JSONB
)

user_wallets (
  id UUID PK,
  user_id UUID,
  chain VARCHAR,  -- 'ethereum', 'tron', 'solana'
  address VARCHAR,
  is_primary BOOLEAN
)
```

### 2.2 商品服务(Listing Service)

**职责**:
- 商品发布 / 编辑 / 下架
- 类目管理
- 搜索(关键词 + 类目 + 标签)
- 推荐(基础)

**数据模型**:
```sql
listings (
  id UUID PK,
  seller_id UUID,
  title VARCHAR,
  description TEXT,
  category_id INT,
  price_amount DECIMAL,  -- 美元等价值
  price_currency VARCHAR,  -- 'USDT', 'ETH'
  price_chain VARCHAR,  -- 'ethereum', 'tron'
  images JSONB,  -- [{url, ipfs_hash}]
  status ENUM('draft','active','sold','removed'),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

categories (
  id INT PK,
  parent_id INT,
  name VARCHAR,
  slug VARCHAR
)
```

### 2.3 订单服务(Order Service)

**职责**:
- 订单创建
- 状态机管理
- 链上 escrow 协调
- 争议发起与处理
- 物流信息同步

**订单状态机**:
```
[pending_payment]
  ↓ 买家发起支付
[escrow_locked]  # 智能合约收到款
  ↓ 卖家发货
[shipped]
  ↓ 买家确认收货
[completed]      # escrow 释放给卖家
  ↓
[disputed]       # 任意方发起争议
  ↓ 仲裁
[resolved]       # 仲裁完成(可能退款 / 部分退 / 释放)

失败路径:
[escrow_locked] --(超时未发货)--> [refunded]
[shipped] --(超时未确认)--> [auto_confirmed]  # 7 天自动确认
```

**数据模型**:
```sql
orders (
  id UUID PK,
  listing_id UUID,
  buyer_id UUID,
  seller_id UUID,
  amount DECIMAL,
  currency VARCHAR,
  chain VARCHAR,
  escrow_contract_address VARCHAR,
  escrow_tx_hash VARCHAR,
  status ENUM(...),
  shipping_info JSONB,
  tracking_number VARCHAR,
  created_at TIMESTAMP,
  paid_at TIMESTAMP,
  shipped_at TIMESTAMP,
  confirmed_at TIMESTAMP,
  completed_at TIMESTAMP
)

disputes (
  id UUID PK,
  order_id UUID,
  initiator_id UUID,
  reason TEXT,
  evidence JSONB,
  status ENUM('open','reviewing','resolved'),
  resolution ENUM('refund','partial_refund','release'),
  resolved_at TIMESTAMP
)
```

### 2.4 钱包服务(Wallet Service)

**职责**:
- 钱包连接验证(签名)
- 链上事件监听
- 交易构造与签名提交
- Nonce 管理
- 链上数据查询

**核心组件**:
```typescript
// 监听服务 - 监听所有链上 escrow 事件
class EscrowMonitor {
  async start() {
    // 订阅 USDT Transfer 事件到 escrow 合约
    // 订阅 EscrowLocked / EscrowReleased 等自定义事件
    // 触发订单状态机
  }
}

// 交易服务 - 构造和发送链上交易
class TxBuilder {
  async lockEscrow(orderId, amount) {
    // 1. 构造 escrow 合约调用
    // 2. 估算 gas
    // 3. 提交到链
    // 4. 等待确认
  }
}
```

### 2.5 合规服务(Compliance Service)

**职责**:
- KYC 状态管理
- 制裁名单检查
- STR / CTR 上报
- 交易限额管理
- 风险评分

**关键规则**:
```
新用户(未 KYC):
  - 只能浏览,不能发布/购买
  - 单日累计: 0

KYC Level 1(身份证 + 自拍):
  - 单日交易 ≤ $1000
  - 累计交易 ≤ $10000

KYC Level 2(+ 地址证明):
  - 单日交易 ≤ $10000
  - 累计交易 ≤ $100000

触发 STR(可疑交易报告):
  - 单笔 > $10000
  - 短时间多笔拆分(避免 CTR)
  - 与制裁名单地址交互
  - 与已知欺诈地址交互
```

## 3. 数据流(关键场景)

### 3.1 场景:买家下单

```
1. 客户端:买家点击"立即购买"
2. Web → 订单服务:POST /api/orders
   - 检查用户 KYC 状态
   - 检查商品可购买
   - 锁定价格(防止价格波动)
3. 订单服务:创建 order(status=pending_payment)
4. 订单服务 → 钱包服务:请求 escrow 构造
5. 钱包服务:返回 escrow 合约地址 + 调用数据
6. Web → 钱包(Wagmi/WalletConnect):发起交易
7. 钱包 → 链:transferAndLock(orderId, amount)
8. 链 → 钱包:tx hash
9. 钱包 → Web:tx hash
10. Web → 订单服务:更新 order(escrow_tx_hash, status=escrow_locked)
11. 钱包服务(监听器):监听到 EscrowLocked 事件
12. 钱包服务 → 订单服务:确认状态
13. 订单服务 → 通知服务:通知卖家
14. 通知服务 → 卖家推送/邮件
```

### 3.2 场景:买家确认收货

```
1. 买家点击"确认收货"
2. Web → 订单服务:POST /api/orders/:id/confirm
3. 订单服务:验证(只有买家能操作,状态必须是 shipped)
4. 订单服务 → 钱包服务:请求 release
5. 钱包服务:构造 release(orderId) 调用
6. 钱包 → 链:release(orderId)
7. 链 → 钱包:tx hash
8. 钱包 → Web:tx hash
9. Web → 订单服务:更新 status=completed
10. 钱包服务(监听器):确认 EscrowReleased 事件
11. 订单服务 → 通知服务:通知双方
12. 通知服务 → 推送/邮件
```

### 3.3 场景:争议处理

```
1. 任意方点击"发起争议"
2. Web → 订单服务:POST /api/disputes
3. 订单服务:创建 dispute,order.status=disputed
4. 双方上传证据(图文、链上证据)
5. 平台客服介入
6. 客服裁决(refund / partial_refund / release)
7. 订单服务 → 钱包服务:执行裁决
8. 钱包服务:refund 或 release 或 split
9. 链上执行
10. 状态更新
```

## 4. 性能与可扩展性

### 4.1 性能目标

| 指标 | 目标 |
|---|---|
| Web TTFB | < 200ms |
| API p99 | < 500ms |
| 搜索 p99 | < 1s |
| 订单创建 p99 | < 1s(含链上确认除外) |
| 链上确认 | 30s - 5min(取决于链) |
| 推送通知到达 | < 5s |

### 4.2 扩展性设计

- **水平扩展**: 所有服务无状态,可水平扩展
- **数据库**: 主从 + 分片(用户表按 ID 哈希)
- **缓存**: Redis 多级(本地 + 集群)
- **CDN**: CloudFront / Cloudflare(静态资源 + IPFS 网关)
- **队列**: Kafka 异步处理(邮件、推送、上报)

## 5. 安全架构

### 5.1 攻击面

| 攻击面 | 防护 |
|---|---|
| Web SQL 注入 | ORM + 参数化 |
| Web XSS | CSP + 输出编码 |
| CSRF | SameSite cookie + Token |
| 鉴权绕过 | JWT + 短过期 + refresh |
| 钱包签名重放 | Nonce + 一次性 |
| 智能合约漏洞 | 审计 + Bug Bounty + 暂停机制 |
| DDoS | Cloudflare + 限流 |
| 内部人员作恶 | 多签 + 权限分离 + 审计日志 |
| 数据泄露 | 加密(at rest) + 最小权限 |

### 5.2 智能合约安全

- **多签钱包**: 平台关键操作需多签(>= 3/5)
- **Timelock**: 大额操作有延迟(48h)
- **Pause**: 发现漏洞可暂停合约
- **Upgrade**: 可升级代理,但需多签 + Timelock
- **审计**: 上线前 2 家独立审计
- **Bug Bounty**: 最高 $100K(根据 TVL)

### 5.3 资金安全

- **平台不持有用户私钥**(用户自管)
- **平台金库**: 多签 + 硬件钱包
- **热钱包 vs 冷钱包**:
  - 热钱包:小额(< $100K)用于日常运营
  - 冷钱包:大额(> $100K)离线
- **保险**: 后续考虑(初期不投)

## 6. 部署架构

### 6.1 推荐部署(云原生)

```
云: AWS / GCP / DigitalOcean
容器: Docker + Kubernetes(EKS / GKE)
CI/CD: GitHub Actions
IaC: Terraform
监控: Prometheus + Grafana
日志: ELK / Loki
APM: Datadog
告警: PagerDuty
```

### 6.2 区域部署

- **应用层**: 多区域(美东、欧西、东南亚)
- **数据库**: 欧盟用户数据存欧盟
- **链上 RPC**: 多节点 + 多服务商冗余
- **CDN**: 全球

## 7. 灾难恢复

| 场景 | 恢复时间目标 | 恢复点目标 |
|---|---|---|
| 单服务故障 | < 5min | 0 |
| 数据库故障 | < 30min | < 1min |
| 整区域故障 | < 1h | < 5min |
| 链上事故 | 立即暂停合约 + 公告 | - |

**备份**:
- 数据库:每日全量 + 实时增量
- 跨区域复制
- 链上:不可逆,**重点在预防**

## 8. 监控与告警

### 8.1 关键指标

- **业务**: GMV, 活跃用户, 转化率, 退款率
- **技术**: 错误率, 延迟, QPS
- **链上**: escrow 余额, 待处理订单, 异常交易
- **合规**: STR 上报数, KYC 通过率

### 8.2 告警规则

- 错误率 > 1% 持续 5 分钟 → P2
- 错误率 > 5% → P1
- 数据库 CPU > 80% 持续 10 分钟 → P3
- 链上 escrow 异常(余额不符) → **P0**
- 智能合约 Pause 被触发 → P0
- 制裁名单命中 → P0
