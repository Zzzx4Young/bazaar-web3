# Bazaar 后端

独立 NestJS/Fastify + Prisma/PostgreSQL 服务。负责认证、商品、购物车订单、
模拟结算、交付、争议与退款、管理员裁决、卖家评价及审计。
接口字段以 [OpenAPI](openapi/alpha.json) 为准；完整项目启动见[根 README](../README.md)。

卖家图片由两个独立 Garage 实例保存：浏览器向 hot 实例上传，后端验证实际字节后
允许关联商品；订单创建时保存图片引用，已完成订单在 `completedAt` 起默认 90 天后
复制并校验至 cold 实例，历史订单仍通过鉴权 API 读取。`ORDER_IMAGE_ARCHIVE_AFTER_DAYS`
可设置 1–3650 天，`ORDER_IMAGE_ARCHIVE_SCAN_SECONDS` 默认 60 秒。归档任务在
`compose.alpha.yaml` 中作为 `archive-worker` 运行；宿主机 `./start.sh` 同样启动它。
`npm run archive:media` 可对已配置 Garage 的环境执行一次扫描，追加 `-- --loop`
持续运行。任务日志记录归档数、失败数、归档积压、数据库引用的热/冷对象数、
过期上传、热副本回收与本轮扫描发现及回收的孤儿对象数；
故障后重跑会保留 hot 引用直至 cold 校验成功。只有所有订单图片引用已切至 cold、
商品不再引用该图片且经过 24 小时宽限期，任务才会再次校验 cold 内容并删除 hot 副本。
本地两个 Garage 容器位于同一主机，不能作为
跨故障域高可用或真实低频计费的验收依据。

## 运行配置

需要 Node.js >=22.12、npm 10.9.8。完整 `infra/compose.alpha.yaml` 会按角色初始化、
迁移、API、前端的顺序启动。单独在宿主机运行时，先准备持久 `bazaar_dev`、
迁移账号的 `.tmp/i7-migrate.env` 和运行账号的 `.env`；两者均为已忽略的私有文件。
不要将管理员或迁移账号配置为 API 的运行连接。

在本目录执行：

```bash
npm ci
npm run build
env DATABASE_RUNTIME_ROLE=bazaar_runtime node --env-file-if-exists=.tmp/i7-migrate.env scripts/deploy-migrations.mjs
npm start
```

`npm start` 从 `.env` 读取运行连接，默认监听 `127.0.0.1:3001`。
Google 登录需创建 Web OAuth 客户端，在服务端配置 `GOOGLE_CLIENT_ID` 和
`GOOGLE_CLIENT_SECRET_FILE`，并把 `${APP_ORIGIN}/api/auth/google/callback` 注册为精确回调地址。
宿主机 `./start.sh` 会读取 `backend/.env`；API-only Compose 部署可叠加
`infra/compose.google-auth.yaml`，用 Docker secret 挂载客户端密钥。
Google 身份以 `sub` 关联账号，不按邮箱自动合并；已有密码账号须登录并重新输入密码后才能绑定。
邮箱验证码固定 6 位、5 分钟有效，服务端使用 PostgreSQL 和 HMAC-SHA256 保存校验状态；
生产环境目前没有邮件发送实现，申请和校验接口均返回 `EMAIL_UNAVAILABLE`。
通过根目录 `./start.sh` 启动的本地开发环境会启用仅限随机测试 Gmail 账号的本地收件箱：
`cat backend/.tmp/dev-email-account` 查看测试邮箱，在登录或注册页申请验证码后运行
`node backend/scripts/read-dev-email-code.mjs` 读取验证码。验证码不会发送至真实邮箱；
测试账号、密钥和收件箱均保存在 Git 忽略的 `backend/.tmp/` 中。勿在公开环境启用此模式。
若网络需要 HTTP(S) 代理访问 Coinbase，使用 Node.js >=22.21 并在启动 Node 进程前设置
`NODE_USE_ENV_PROXY=1`，同时提供可信的 `HTTPS_PROXY` 和适当的 `NO_PROXY`。
根目录的 `./start.sh` 会在检测到代理变量时自动为宿主机后端设置此开关。
启动不会自动迁移、生成商品或清理数据库。部署容器可用 `DATABASE_URL_FILE`
挂载连接信息，不能同时设置 `DATABASE_URL`；镜像与回滚见本地
`docs/api-deployment-runbook.md`。

`POST /api/health/live` 检查进程；`POST /api/health/ready` 查询数据库。
前端 Origin 必须等于 `APP_ORIGIN`（默认 `http://localhost:3000`），写请求携带会话 Cookie
和 CSRF token。每个响应带 `X-Request-Id`；错误和脱敏日志使用同一 ID。
汇率快照有效期为 1 小时，过期且供应商不可用时排序返回 `FX_UNAVAILABLE`。
首页使用公开的 `POST /api/listings/home`，一次返回最新商品 10 件、数字与实物各至多 5 件；
三组都直接读取 PostgreSQL 商品，类型区块不会受最新 10 件的组成影响。
服务启动后及此后每分钟处理一次超过 30 分钟的待付款订单，释放受限库存并记录系统事件。
每批最多扫描 100 笔，按创建时间和订单 ID 推进；库存一致性异常会回滚该笔事务并报告失败，
后续订单继续处理。扫描到末尾后重新从头开始，异常订单修复后会再次处理。
登录 IP 和规范登录名的一分钟限流计数由 PostgreSQL 原子维护，多 API 实例共享额度；
服务每分钟分批清理过期计数。每实例同时最多执行 2 次密码哈希以保护本机资源。
反向代理部署可设置 `TRUSTED_PROXY_CIDRS`（逗号分隔 IP/CIDR），使登录限流使用客户端 IP；
默认关闭，非可信来源的 `X-Forwarded-For` 被忽略，代理链从最近端向外停在第一个非可信节点。
配置只应包含实际代理地址；入口必须覆盖或安全追加转发头，网络访问应限制到这些代理。
Next.js 的 `/api` rewrite 会保留已有转发头，不能单独作为头部清洗入口；公网部署需先由
可信入口清洗，再经 Next.js 转发，或让可信入口直接代理 `/api` 到后端。
本机开发保持默认关闭；不要仅为区分浏览器而信任 loopback 上未清洗的 Next.js rewrite。
连接池参数集中在 `database-policy.ts`，支持 `DB_POOL_MAX`（默认 5，范围 1–100）、
`DB_CONNECT_TIMEOUT_MS`（默认 3000）、`DB_IDLE_TIMEOUT_MS`（默认 10000）和
`DB_STATEMENT_TIMEOUT_MS`（默认 3000）；超时范围为 1–600000 毫秒，禁止禁用超时。
连接数是每个 API 实例的上限；部署时以最大副本数乘以连接上限，并为迁移、运维和其他
数据库使用者保留容量。提高上限需结合实际压测与 PostgreSQL `max_connections`，
配置范围本身不代表系统已达到相应吞吐能力。
每实例请求接纳上限 `API_MAX_IN_FLIGHT` 默认 200（范围 1–10000），在认证及数据库
访问前限制同时处理的请求；超额立即返回 `503 / OVERLOADED`、`retryable=true` 和请求 ID，
响应不缓存。存活检查不占用名额；数据库就绪检查受此限制。客户端断开不会提前释放仍在
执行的数据库工作名额，处理结束后回收。接纳上限与数据库连接上限分别配置，均需压测验证。
数据库连接中断、不可达、连接池不可用或旧主库降为只读后的写入拒绝会返回
`503 / DATABASE_UNAVAILABLE`，
且 `retryable=true`；响应只包含错误码、重试标记和请求 ID，不包含 SQL 或连接信息。
写入重试必须保留原请求及幂等键：错误响应不能证明事务未提交，
服务端不会因断线自动重放事务。SQL 缺陷仍返回 500，库存等业务冲突仍返回 409。
订单幂等回放在校验原请求和访问权限后，对原幂等记录执行逻辑内容不变的更新，使确认
旧结果也经过同步提交屏障；不会新增订单或业务事件。这会产生额外 WAL，性能结果需复测。
公开服务容量目标为 1000 人同时在线、500 请求/秒、至少 2 个 API 实例；
短时查询、混合创建/取消、API 崩溃切换和本机主备人工及自动切换已实测；完整验收与复现命令见
[容量与可用性验收](CAPACITY.md)。
真实数据来源、命名策略及未完成项见[工程标准化总览](STANDARDIZATION.md)。
`npm run test:watchdog:required` 验证真实 Patroni 对缺失设备的拒绝激活及启动配置防覆盖，
不挂载宿主机设备；镜像默认要求 watchdog，本机 HA Compose 只提供明确的诊断豁免。
该测试不证明物理 fencing，部署边界及实际结果见[HA 文档](../infra/HA.md)。
`npm run test:postgres-ha:gateway` 验证两个独立数据库代理的故障与恢复：
原 API、地址和会话保持不变，确认订单及幂等回放逐笔核对；详见 HA 文档。
API 就绪检查拒绝 PostgreSQL 备库或只读会话，存活检查不依赖数据库。
同步主备混合负载入口为 `npm run test:capacity:ha`，首次需按 HA 文档构建专用镜像；
它创建独立本机集群。检索以一条参数化查询读取真实页数据、总数、卖家和库存，
避免跨多次查询占用连接，金额和时间格式保持原契约。
同步主备五分钟混合负载及 API 故障已通过的配置为每 API 10 条连接；对应实际运行配置
是 `DB_POOL_MAX=10`，容量脚本控制项是 `CAPACITY_POOL_MAX=10`。默认 5 条连接仍未通过
该故障矩阵；运行预算须另为迁移、运维和复制保留连接。
持续 500 请求/秒下的本机主库故障已通过当前实现两分钟实测：29.287 秒恢复写入，6000 笔故障
模型订单核对无丢失，故障 503 和恢复回放分别统计。入口为
`CAPACITY_DATABASE_FAULT=primary-kill CAPACITY_POOL_MAX=10 CAPACITY_SECONDS=120 npm run test:capacity:ha`，
命令及子进程退出码零，专用清理回执保存在 `.tmp/passed-primary-replay-durability-ha-capacity-run.json`。
全部备库失联带负载已通过当前实现复测：60000 个请求零丢弃，23.611 秒恢复写入；
确认停止的 15.015 秒窗口内新请求成功确认零笔，6000 笔故障模型订单及关联数据审计通过。
故障窗口包含 11146 次 503 和 20 次传输超时，均未计作成功；恢复回放单独统计。
命令及子进程退出码零，清理回执保存在 `.tmp/passed-replicas-protection-ha-capacity-run.json`。
入口使用 `CAPACITY_DATABASE_FAULT=replicas-stop`，其余参数同上；更广故障矩阵仍待验收。
当前实现还通过十分钟同步主备混合负载和 API 故障复测：300000 请求完成，零错误和丢弃，
15000 笔订单及四个命令阶段全部核对。时钟门禁记录最大偏差 0.907 毫秒；
会话 fixture 使用实际认证策略，首轮时钟跳变失败证据保留，详见容量文档。
HA 容量模式启动资源前执行最多 60 秒时钟预检，异常时写入
`.tmp/capacity-clock-preflight.json` 并退出；预检通过后仍须通过测量期间的时钟和业务门禁。
双数据库代理故障容量复测因系统墙钟跳变尚未通过，详情见 [CAPACITY.md](CAPACITY.md)。
分页默认值和上限集中在 `common/pagination-policy.ts`，前端镜像策略及 OpenAPI 参数由
契约测试核对；事务次数、锁等待和退避由 `database/transaction-policy.ts` 管理。
汇率缓存保持真实 Coinbase 快照和一小时有效期，供应商超时、响应大小与缓存时长集中在
`pricing/rates-policy.ts`，不使用固定汇率兜底。
连接 URL 不允许携带 `statement_timeout`、`options`、`connectionTimeoutMillis` 或
`query_timeout`，避免驱动解析 URL 时覆盖应用策略；数据库 schema 仍通过 `schema` 参数指定。

## 本机账户与 V2 数据

预置账户需迁移账号。将输入 JSON 放在权限 0600 的 `backend/.tmp/`，
格式为 `[{"loginName":"...","displayName":"...","password":"..."}]`，
密码 15–128 字符；同名账户会使整批回滚。单账户密码重置输入为
`{"loginName":"...","password":"..."}`，执行后撤销其既有会话。

```bash
SEED_ACCOUNTS_FILE=.tmp/accounts.json node --env-file-if-exists=.tmp/i7-migrate.env scripts/provision-accounts.mjs
SEED_ACCOUNTS_FILE=.tmp/reset.json node --env-file-if-exists=.tmp/i7-migrate.env scripts/provision-accounts.mjs --reset-password
```

`npm run seed:v2` 使用上述迁移连接，仅允许 loopback PostgreSQL；以
`v2-stress-r2` 前缀一次性增加 14 个测试账户、200 件多币种商品、60 笔多状态订单、
3 组跨卖家购物车订单和卖家评价。重复运行遇到同名账户会拒绝写入。
这批数据只供本机开发，不会随服务启动生成；`compose.alpha.yaml` 使用独立数据库卷，
且容器内数据库地址不是 loopback，因此此宿主机种子命令不会填充该 Compose 环境。
测试账户密码应通过私有 `V2_SEED_PASSWORD` 环境输入提供，不要用于真实账户。

旧版 V2 种子可能留下类型与类目不一致的商品。先运行
`node --env-file-if-exists=.tmp/i7-migrate.env scripts/repair-v2-categories.mjs`
预览数量；确认本机目标后附加 `--apply`。脚本只接受 loopback 数据库，
只改 V2 测试商品的类目及标题。订单快照由数据库约束保持不可变，历史记录不会重写。
若旧版 V2 测试订单缺少库存预留，导致自动过期扫描反复失败，可先运行
`node --env-file-if-exists=.tmp/i7-migrate.env scripts/repair-v2-unreserved-orders.mjs`
查看聚合候选数，再附加 `--apply`。脚本仅将超时、未结算、无预留、商品仍可售的
V2 实物测试订单标记过期并新增审计事件，不改库存或既有历史记录。

## 数据库观察与验证

安装 PostgreSQL 17 客户端后，`npm run db:psql` 默认使用只读 `bazaar_observer`；
`npm run db:psql -- runtime` 和 `-- migrate` 才使用相应角色。
本机首次观察可运行 `npm run db:observer:setup`；迁移后运行
`npm run db:observer:grant` 刷新 19 个脱敏视图。观察角色不能读取密码、
会话哈希、自由文本、地址或交付密钥，也不能写业务表。

```bash
npm run check:backend
node scripts/with-test-db.mjs npm run test:db
```

数据库集成测试使用独立 `127.0.0.1:55432/bazaar_test` 和随机 schema，
按文件串行迁移，避免并发建索引与多个 Prisma 迁移进程争锁；单文件内的并发竞争测试照常运行。
需要先从仓库根目录启动 `postgres-test`；不会回退到开发库：

```bash
sudo docker compose -f infra/compose.yaml --profile test up -d --wait postgres-test
```

前端的 `npm run test:e2e:alpha`、`npm run test:e2e:v2` 会自行启动和停止该测试容器。
持久化升级和备份恢复另用 `postgres-validation`，见[基础设施 README](../infra/README.md)。
自动主备验收入口为 `npm run test:postgres-ha:auto`，首次需要构建专用 Patroni 镜像；
它使用独立三数据节点、三仲裁节点和两个 API，不操作开发库。
目标为已确认订单零丢失、60 秒内恢复写入、无备库时暂停成功确认；
步骤、实测结果和未验收的生产边界见[数据库自动切换验收](../infra/HA.md)。
`database-outage.integration.mjs` 使用独立随机测试 schema 和本机 TCP 代理，
验证真实连接关闭时的 503、私有信息保护及同一 API 在连接恢复后的正常读取；
另外验证池连接转为只读后的登录写入拒绝为 503，恢复写入后原 API 能重新登录。
当前测试会输出 pg 的查询队列弃用警告，调用栈位于 Prisma PgTransaction 适配器；
断线和恢复断言通过。该警告仍需在后续驱动兼容性升级时处理，未在测试中隐藏。
后端代码位于 `src/`，追加迁移位于 `prisma/migrations/`，数据库与 HTTP 测试位于 `tests/`；
迁移脚本、种子和观察入口位于 `scripts/`。已执行迁移不改写。
