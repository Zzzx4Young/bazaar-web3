# 06. 技术选型

## 1. 客户端

### 1.1 Web App

| 选型 | 推荐 | 备选 | 理由 |
|---|---|---|---|
| **框架** | Next.js 14 (App Router) | Remix, SvelteKit | 生态最成熟,SSR 友好 |
| **语言** | TypeScript | — | 类型安全,必备 |
| **UI 库** | shadcn/ui + Tailwind | Mantine, Chakra | 高度可定制,不锁定 |
| **状态管理** | Zustand | Jotai, Redux Toolkit | 轻量,够用 |
| **数据获取** | TanStack Query | SWR | 缓存、乐观更新 |
| **钱包** | Wagmi v2 + Viem | web3-react, ethers | 现代、TypeScript 优先 |
| **WalletConnect** | Reown AppKit (前 WalletConnect) | — | 必备 |
| **表单** | React Hook Form + Zod | Formik | 强类型校验 |
| **i18n** | next-intl | next-i18next | 多语言 |
| **地图** | Mapbox GL | Google Maps | 物流追踪 |
| **图表** | Recharts | Chart.js | 简单的分析图表 |

### 1.2 iOS App

| 选型 | 推荐 | 备选 | 理由 |
|---|---|---|---|
| **语言** | Swift 5.9+ | — | 必备 |
| **UI 框架** | SwiftUI | UIKit | 现代,Apple 推 |
| **架构** | MVVM + Combine | TCA, VIPER | 主流 |
| **网络** | URLSession + async/await | Alamofire | 现代 |
| **钱包** | WalletConnect Swift SDK | Web3.swift | 链上交互 |
| **Web3** | web3.swift | — | 钱包签名 |

### 1.3 Android App

| 选型 | 推荐 | 备选 | 理由 |
|---|---|---|---|
| **语言** | Kotlin | Java | 现代 |
| **UI 框架** | Jetpack Compose | XML + View | 现代 |
| **架构** | MVVM + Flow | MVI | 主流 |
| **网络** | Retrofit + OkHttp + Coroutines | Ktor | 成熟 |
| **钱包** | WalletConnect Kotlin SDK | web3j | 链上交互 |

### 1.4 共享代码(可选)

- **业务逻辑**: Kotlin Multiplatform / Rust
- **链上逻辑**: TypeScript(共享给 Web)
- MVP 阶段**不做共享**,先快后优

## 2. 后端服务

### 2.1 运行时

| 选型 | 推荐 | 备选 | 理由 |
|---|---|---|---|
| **主语言** | **Node.js + TypeScript** | Go, Python | 团队招人容易,生态丰富 |
| **Web 框架** | Fastify | Express, Hono | 高性能 |
| **API 风格** | REST + JSON | GraphQL, tRPC | 主流,易调试 |
| **API 文档** | OpenAPI 3 + Swagger | Stoplight | 标准 |
| **RPC / 内部** | gRPC | — | 服务间 |

**为什么不用 Go**: Go 性能好,但 Web3 生态集中在 Node.js/TS,**招人更快**。性能不是瓶颈(数据库/链上才是)。

### 2.2 数据库

| 用途 | 选型 | 理由 |
|---|---|---|
| **主数据** | PostgreSQL 15+ | 强类型,JSONB,生态成熟 |
| **缓存/会话** | Redis 7+ | 必备 |
| **搜索** | Elasticsearch / Meilisearch | 全文搜索 |
| **时序/日志** | TimescaleDB / ClickHouse | 分析 |
| **文件元数据** | PostgreSQL | 简单 |

**为什么不用 MongoDB**: 二手交易关系性强(用户-订单-商品-评价),SQL 更合适。

### 2.3 消息队列

| 选型 | 推荐 | 备选 | 理由 |
|---|---|---|---|
| **主队列** | Apache Kafka | RabbitMQ, NATS | 高吞吐,生态成熟 |
| **任务队列** | BullMQ (Redis) | — | 简单任务 |

### 2.4 实时通信

| 用途 | 选型 |
|---|---|
| **IM(WebSocket)** | Socket.io / 自建 ws |
| **推送(APNs/FCM)** | Firebase / OneSignal |
| **邮件** | SendGrid / Postmark |
| **SMS** | Twilio |

## 3. 区块链

### 3.1 智能合约

| 选型 | 推荐 | 备选 | 理由 |
|---|---|---|---|
| **语言** | Solidity 0.8.20+ | Vyper | 主流 |
| **框架** | Foundry | Hardhat | 快,测试覆盖好 |
| **库** | OpenZeppelin Contracts 5.x | — | 必备 |
| **升级模式** | UUPS Proxy | Transparent Proxy | 简洁 |
| **多签** | Safe{Wallet} (前 Gnosis Safe) | — | 平台金库 |
| **审计** | OpenZeppelin + Trail of Bits / Spearbit | CertiK | 至少 2 家 |

### 3.2 链上交互

| 用途 | 选型 | 备选 |
|---|---|---|
| **RPC 节点** | Alchemy | Infura, QuickNode, Ankr |
| **多链抽象** | Viem | Ethers.js, Web3.js |
| **钱包连接** | WalletConnect / Reown | — |
| **事件索引** | The Graph | Ponder, Goldsky |
| **Gas 估算** | Alchemy Gas Manager | — |
| **价格预言** | Chainlink (USDT 假设 $1) | — |

### 3.3 账户抽象(ERC-4337)

| 选型 | 推荐 | 理由 |
|---|---|---|
| **Bundler/Paymaster** | Alchemy Account Abstraction | 一站式 |
| **SDK** | @alchemy/aa-core | 易用 |
| **钱包服务商** | Magic.link / Web3Auth | 社交登录 |

**MVP 后期引入** — 让用户用邮箱/Google 登录,免私钥管理。

## 4. 第三方服务

### 4.1 KYC/AML

| 服务 | 选型 | 费用 | 备注 |
|---|---|---|---|
| **KYC** | **Sumsub** | ~$1-3/验证 | 推荐,全球覆盖 |
| 备选 | Onfido | 类似 | — |
| 备选 | Persona | 偏美国 | — |
| **链上分析** | **Chainalysis** | $30-80K/年 | 制裁名单 + 风险评分 |
| 备选 | Elliptic | 类似 | — |
| 备选 | TRM Labs | 类似 | — |

### 4.2 物流

| 服务 | 选型 |
|---|---|
| **物流追踪** | **AfterShip** (全球) |
| 备选 | 17Track |
| **承运商 API** | FedEx, UPS, DHL(高级) |

### 4.3 监控

| 用途 | 选型 |
|---|---|
| **APM** | Datadog / Sentry |
| **日志** | ELK / Grafana Loki |
| **错误追踪** | Sentry |
| **Uptime** | BetterUptime / Pingdom |
| **告警** | PagerDuty / Opsgenie |

### 4.4 邮件/SMS

| 用途 | 选型 |
|---|---|
| **邮件** | SendGrid (推荐) / Postmark / Resend |
| **SMS** | Twilio / MessageBird |
| **推送** | Firebase Cloud Messaging / APNs |

## 5. 基础设施

### 5.1 云服务商

| 选型 | 推荐 | 备选 | 理由 |
|---|---|---|---|
| **主云** | **AWS** | GCP, DigitalOcean | 生态最全 |
| **区域** | 多区域部署 | — | 见架构 |
| **CDN** | CloudFront | Cloudflare | 全球 |

### 5.2 容器与编排

| 选型 | 推荐 | 备选 |
|---|---|---|
| **容器** | Docker | — |
| **编排** | Kubernetes (EKS) | ECS, Nomad |
| **服务网格** | (暂不需要) | Istio |
| **API 网关** | Kong / AWS API Gateway | — |

### 5.3 CI/CD

| 选型 | 推荐 |
|---|---|
| **代码托管** | GitHub |
| **CI** | GitHub Actions |
| **CD** | ArgoCD / Spinnaker |
| **IaC** | Terraform |
| **密钥管理** | HashiCorp Vault / AWS Secrets Manager |

## 6. 安全

### 6.1 应用安全

| 用途 | 选型 |
|---|---|
| **WAF** | Cloudflare / AWS WAF |
| **DDoS 防护** | Cloudflare |
| **漏洞扫描** | Snyk / Trivy / Dependabot |
| **渗透测试** | 外部(每年) |
| **秘密管理** | AWS Secrets Manager |

### 6.2 链上安全

| 用途 | 选型 |
|---|---|
| **合约审计** | OpenZeppelin + (Trail of Bits / Spearbit) |
| **形式化验证** | Certora(后续) |
| **Bug Bounty** | Immunefi |
| **实时监控** | Forta / Tenderly |
| **多签** | Safe{Wallet} |
| **Timelock** | Compound Timelock |

## 7. 开发与协作

### 7.1 协作

| 选型 | 推荐 |
|---|---|
| **项目管理** | Linear / Jira |
| **文档** | Notion / Confluence |
| **设计** | Figma |
| **沟通** | Slack / Discord |
| **代码审查** | GitHub PR |

### 7.2 监控业务

| 指标 | 工具 |
|---|---|
| **产品分析** | PostHog / Mixpanel / Amplitude |
| **会话回放** | PostHog / LogRocket |
| **A/B 测试** | PostHog / GrowthBook |
| **错误追踪** | Sentry |

## 8. 推荐栈总览

```
┌──────────────────────────────────────────────────────────┐
│ Client: Next.js 14 + TS + Tailwind + Wagmi v2            │
│ Mobile: Swift/SwiftUI + Kotlin/Compose                   │
├──────────────────────────────────────────────────────────┤
│ Backend: Node.js 20 + TypeScript + Fastify               │
│ Database: PostgreSQL 15 + Redis 7 + Elasticsearch        │
│ Queue: Kafka + BullMQ                                    │
├──────────────────────────────────────────────────────────┤
│ Blockchain: Solidity 0.8 + Foundry + OpenZeppelin        │
│ RPC: Alchemy + The Graph                                 │
│ Wallet: WalletConnect + Alchemy AA                       │
├──────────────────────────────────────────────────────────┤
│ Infrastructure: AWS (EKS) + CloudFront + Terraform       │
│ CI/CD: GitHub Actions + ArgoCD                           │
│ Security: Cloudflare + Snyk + Sumsub + Chainalysis       │
│ Monitoring: Datadog + Sentry + PagerDuty                 │
└──────────────────────────────────────────────────────────┘
```

## 9. MVP 阶段成本估算(月度)

| 类别 | 服务 | 估算(月度) |
|---|---|---:|
| **云基础设施** | AWS / Vercel | $500-2000 |
| **数据库** | PostgreSQL + Redis | 含在云 |
| **RPC** | Alchemy | $200-1000 |
| **The Graph** | 索引 | $100-500 |
| **KYC** | Sumsub | 按用量,$500-3000 |
| **链上分析** | Chainalysis | $2500-6500 |
| **邮件/SMS** | SendGrid + Twilio | $100-500 |
| **监控** | Datadog + Sentry | $200-1000 |
| **审计(年度分摊)** | OpenZeppelin 等 | $3000-8000 |
| **Bug Bounty** | Immunefi | $5000+(年度) |
| **总月度** | | **$12K-$25K** |

**注**: 这是运营成本,不含人力。

## 10. 决策记录

| 决策 | 选择 | 否决方案 | 理由 |
|---|---|---|---|
| 主语言 | TypeScript | Go, Rust | 生态 + 招人 |
| Web 框架 | Next.js | Remix, SvelteKit | 生态最成熟 |
| 数据库 | PostgreSQL | MongoDB | 关系数据 |
| 合约语言 | Solidity | Vyper | 主流 |
| 合约框架 | Foundry | Hardhat | 快,现代 |
| 链 | Ethereum L1 + L2 | Solana, TON | 用户群最广 |
| KYC | Sumsub | Onfido, Persona | 覆盖好 |
| 链上分析 | Chainalysis | Elliptic, TRM | 行业标准 |
| 云 | AWS | GCP | 生态 |
| 钱包 | WalletConnect | 自建 | 必备 |
