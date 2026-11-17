# Bazaar 后端

## 2026-11-17 独立审查返工边界

返工从 `afb1bfa63e63d8db6b252aa70125aa8679bde11c` 开始，冻结规格仍为
`web3-testnet-review-2026-11-06-r2`。R01/R02/R03/R04/R05 和清理诊断/隔离保护已补修；
R08 原始首单 500 的历史根因尚未确定，新增的是白名单脱敏诊断，不能称为根因修复。
R07 原始三个清理超时没有稳定复现；新夹具区分主断言和清理错误，按集群、数据库 OID/owner
及本次成功创建记录清理，不终止未知会话、不强制删除。不要把有界 DDL 预算当作历史根因结论。

R06 三项分别验收：附件上传被实际 API 拒绝后仍可在原窗口链上争议；控制镜像的超时/OOM
实测；实际字节容量采样。500 MB ZIP 在当前 64 MB 临时盘预算下无法完整扫描，容量专项保持
未通过。1 GB 临时盘仅用于诊断，不改变产品配置。控制镜像与可复跑命令见
[file-checker/control/README.md](file-checker/control/README.md)。

本地测试应显式注入 `WEB3_TEST_PORT`，使用专属 `bazaar_test` 实例和私有对象桶。
受控恢复只接受显式 `TEST_DATABASE_URL` 的同一端点和本次夹具确切 schema；无默认端口回退。
T10 整体待验收，`targetsMet=false`，第五批 RPO/RTO 仍为 `null`；真实独立保管、外部 RPC、
真实提供方及整机丢失恢复未因本轮返工而通过。


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

### 测试网隔离实施

`web3-spec.json` 记录本轮实施依据的规格版本和内容摘要；设计文档位于本地忽略的
`docs/`，源码提交并不包含这些文档。验收记录需同时关联源码提交、规格摘要和用例编号。
Web3 默认关闭。启用必须显式配置 `WEB3_ENABLED=1`、`WEB3_CHAIN_ID=11155111`、
`WEB3_TOKEN_ADDRESS`、`WEB3_ESCROW_ADDRESS`、两家独立来源的 `WEB3_RPC_PRIMARY`/
`WEB3_RPC_SECONDARY`、固定的 `WEB3_SECURITY_LEDGER_ID` 和 `WEB3_SECURITY_LEDGER_URL_FILE`
（或互斥的同名无 FILE 变量）。
仅测试环境允许 `WEB3_PROFILE=local` 与 chainId 31337；不接受主网配置。
声明不同 RPC 主机只是初步检查，不代表已验证供应商独立性或 finalized 能力。

钱包业务投影迁移不创建权威安全账本。账本须独立持久保护，不能与业务旧备份一起回退；
不可核验时返回 `503 / WALLET_UNAVAILABLE`，不依赖“删掉旧 Session”猜测钱包归属。
密钥、账本连接、真实部署与公开测试网权限不由这些默认配置自动生成。

专用可销毁测试环境使用项目 `bazaar-web3-web3-local`、端口 55435；从本目录运行
`node scripts/with-web3-test-db.mjs node --test tests/web3-foundation.integration.mjs`。
它只读取隔离测试库密码，不读取开发 `.env`，不连接 5432 开发库。
金额和钱包基础测试入口为 `npm run build && node --test tests/web3-policy.test.mjs`。

钱包身份 HTTP 已接入，默认关闭；T09已完成本地身份入口与主要浏览器闭环，外部提供方及部署仍待验收。认证流程复用现有 Session、Origin、
JSON 和 CSRF 校验。绑定须账户独立重新认证及新钱包专用 EIP-712 签名；解绑不依赖旧钱包
签名。SIWE 仅用于登录，不能作为绑定或收款授权。三类重新认证来源分别记录为
`password`、`google_oidc`、`email_code`／`email_code_dev`，不把近期登录 Session 当作操作证明。
钱包会话不能自行添加或替换独立恢复身份，开发邮箱绑定快捷开关也不能绕过此限制。
凭据绑定操作、目标钱包、账户、会话、签发链／托管合约、绑定版本和恢复代次，最多300秒；创建后续挑战不续期。
链下 EIP-712 授权使用明确的 `expiresAtMilliseconds`，与接口 ISO 截止精确一致；
不要将其作为 T04／T06 链上凭证的秒级时间字段。

| 接口（均在 `/api/auth/wallet` 下） | 用途 |
|---|---|
| `POST /current` | 当前绑定摘要，空 JSON 请求及 CSRF |
| `POST /reauth/password` | 密码独立重新认证 |
| `POST /reauth/email/request`、`/verify` | 当前已验证邮箱的专用验证码；不接受任意邮箱替换 |
| `POST /reauth/google/start`、`GET /reauth/google/callback` | 当前已绑定 Google sub 的专用 OAuth；不登录、不关联新身份 |
| `POST /challenge`、`/consume` | 创建并消费绑定／解绑授权 |
| `POST /login/challenge`、`/login/verify` | 公开 SIWE 挑战及验证；成功轮换旧 Session |

除公开登录两接口外均需当前 Session；所有 POST 需要 Origin 和 JSON，已登录操作还需
CSRF。重新认证申请及 action challenge 使用现有 `Idempotency-Key` 格式；同键不同目标
返回 `IDEMPOTENCY_CONFLICT`。公共和签名消费路径使用现有每IP每分钟10次限制；密码证明
另受每账户每分钟5次及哈希并发限制。邮箱／Google 申请另按账户每15分钟5次，邮箱验证
每15分钟10次、单凭据最多5次失败。重试不更新凭据截止，也不重复绑定。

Google Cloud 需另外登记 `${APP_ORIGIN}/api/auth/wallet/reauth/google/callback` 作为授权
回调，沿用现有 Client ID/Secret；专用回调要求原 Session、state、PKCE、OIDC nonce 和独立
浏览器 Cookie。Google `sub` 必须仍属于原账户，不按邮箱合并。未配置提供方时拒绝相应入口。
开发期间仍可使用本地收件箱，通过
`node scripts/read-dev-email-code.mjs --email name@gmail.com --purpose wallet_reauth` 取码；
该凭据保留开发来源，不能在真实邮件提供方模式下冒充真实投递认证。

`security-ledger/schema.sql` 不属于业务迁移或业务恢复。API 必须连接独立数据库及专用运行
角色，不能指向业务数据库或使用账本 owner。初始化前由运维单独创建名为 `wallet_security`
或 `wallet_security_*` 的数据库和无成员关系的运行角色，再显式执行：

```bash
WEB3_SECURITY_LEDGER_OWNER_URL_FILE=/path/to/owner-url \
WEB3_SECURITY_LEDGER_RUNTIME_ROLE=wallet_runtime \
WEB3_SECURITY_LEDGER_ID=<fixed-uuid> \
node scripts/provision-wallet-ledger.mjs --confirm-independent-ledger
```

脚本不会替换已有账本或重置恢复代次；owner连接不放入API配置。API启动校验角色最小权限，
运行角色仅能读取元数据、追加永久归属和事件，不能修改恢复代次或删除归属；业务角色不能
读取账本。每次核验要求可写主库，缺失、维护、只读来源、实例身份不匹配或未决操作均阻断
相关授权。独立备份、耐久性和恢复运维仍须 T10／部署演练验证，不能把两个测试schema当作
跨故障域保障。

流程先账本预占、再提交业务事务、最后确认账本。未知数据库提交结果保留未决状态；成功
业务提交可按原请求补完账本确认。并发重试读取原结果，不能撤销其他请求已提交的操作。
已知回滚也须在账户锁内确认尚未提交、失效挑战后才能释放预占。恢复代次变化后，旧操作
不得继续完成；恢复必须停写并按 T10 的受控流程核对，禁止凭旧备份中没有记录自行清空预占。

绑定及 SIWE 登录会检查两路RPC的目标链ID、latest与finalized执行代码，拒绝合约钱包和
委托执行；任一RPC失败、响应不合法、来源矛盾均返回 `WALLET_UNAVAILABLE`。请求5秒超时，
单响应上限65536字节，不重试到单源。此为当前账户准入检查，不是支付的双源同块 finalized
核验，也不保证钱包以后不改变执行方式；T06的资金入口仍须独立约束执行路径。

从本目录验证本地身份验收及原登录回归：

```bash
npm run check:backend
node scripts/with-web3-test-db.mjs node --test --test-concurrency=1 tests/wallet-identity.integration.mjs tests/wallet-security-ledger.integration.mjs tests/wallet-ledger-roles.integration.mjs tests/wallet-reauth.integration.mjs tests/wallet-http.integration.mjs tests/wallet-provision.integration.mjs tests/auth.integration.mjs tests/auth-identity.integration.mjs tests/roles.integration.mjs
```

测试仅使用独立55435数据库、随机业务／账本schema及临时虚拟身份。RPC和Google提供方
使用本地故障替身，签名实际生成和验证；不使用真实用户钱包或真实邮件。真实Sepolia RPC、
部署、完整灾难恢复、资金操作及网页钱包验收仍属于后续任务，不能记作本地T02测试通过。

### 现有 Alpha 配置

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
商品承诺采用发布开关 `LISTING_COMMITMENT_POLICY`：默认 `compat`，旧客户端省略
`commitment` 时仍可创建并浏览商品，但返回 `commitment=null`、
`purchaseEligible=false`、`purchaseBlockReason=missing_commitment`，订单服务拒绝下单；
卖家补全承诺后才可购买。只兼容**省略**字段，传入空值或不完整承诺仍返回
`INVALID_INPUT`。待旧客户端升级并完成历史商品补录后，设置 `enforce`，新发布
缺少承诺即返回 `INVALID_INPUT`；编辑与公开返回字段不受开关影响。回滚校验只需
恢复 `compat` 并重启 API，无需回滚数据库迁移；切换前后已创建的缺承诺商品始终
不可购买。
数字商品承诺记录交付清单、用途范围、限制、预计交付时间及文件或访问期限；
实物商品承诺记录成色、缺陷、配件、功能状态和预计发货时间。下单时将承诺写入
`OrderSnapshot`，后续商品修改不改变已有订单。用户可投诉商品，管理员可暂停、驳回或
复核并处理受影响订单；暂停时禁止继续交易。商品承诺安全修复对禁止的权利转让表述
先做 Unicode 兼容规范化、零宽字符和空白处理；复核备注在事务内锁定商品和订单，
重新确认订单仍处于暂停状态后才写入事件。此规则不能替代人工审核。
Google 登录需创建 Web OAuth 客户端，在服务端配置 `GOOGLE_CLIENT_ID` 和
`GOOGLE_CLIENT_SECRET_FILE`，并把 `${APP_ORIGIN}/api/auth/google/callback` 注册为精确回调地址。
宿主机 `./start.sh` 会读取 `backend/.env`；API-only Compose 部署可叠加
`infra/compose.google-auth.yaml`，用 Docker secret 挂载客户端密钥。
Google 身份以 `sub` 关联账号，不按邮箱自动合并；已有密码账号须登录并重新输入密码后才能绑定。
邮箱验证码固定 6 位、5 分钟有效，服务端使用 PostgreSQL 和 HMAC-SHA256 保存校验状态；
生产环境目前没有邮件发送实现，申请和校验接口均返回 `EMAIL_UNAVAILABLE`。
通过根目录 `./start.sh` 启动的本地开发环境允许任意格式合规的 Gmail 地址申请注册、登录或绑定验证码。
验证码不会发送至真实邮箱；在页面申请后运行
`node backend/scripts/read-dev-email-code.mjs --email your.name@gmail.com --purpose register`
读取本地验证码，登录时将用途改为 `login`，绑定时改为 `bind`。不同地址的验证码互不覆盖。
密钥和收件箱保存在 Git 忽略的 `backend/.tmp/` 中，本地绑定免再次输入密码仅在显式启用的
development、loopback 环境可用；生产环境保持再次认证要求。

账号的 `id` 始终是订单、商品及会话的归属键。Gmail 登录名或 `GmailClaim` 只保留
邮箱别名的归属，不能证明已验证邮箱；验证码登录还需对应的 `AccountIdentity(provider=email)`。
Gmail 去点号与 `+` 标签仅适用于 `gmail.com`，其他邮箱域名不能直接沿用此规则。
Google 身份以单一 Google 提供方的 `sub` 识别；增加其他 OIDC 发行方前应将发行方纳入身份键。
新建 Session 记录 `authMethod` 和 `authenticatedAt`；邮箱与 Google 身份记录验证时间和来源，
绑定、换绑在同一事务中追加不可修改的 `AccountIdentityEvent`。既有记录保留空来源，
不会假定历史邮箱已通过真实投递验证。开发收件箱验证码标记为 `dev_inbox`，不能作为
真实邮箱所有权的证明。身份事件保留变更前后的标识与邮箱，属于敏感历史数据；
运行角色仅能追加，不能读取、修改或删除，审计读取应使用受控的管理连接。
历史 Google 身份的 Gmail 归属在迁移时回填；遇到不同账号争用同一归属，迁移会失败并等待人工处理。
开发账号改写邮箱时会清除旧邮箱验证来源，并追加来源为 `unknown` 的迁移事件。
`npm run auth:check-claims` 使用 `.env` 中的运行连接执行只读、一致性快照检查，
核对登录名、邮箱与 Google 身份所需的 Gmail 归属；结果仅输出问题类型和账号 ID，
不会输出地址或验证码。发现漂移时退出码为 1，不会自动修改归属；每表超过 5 万条时
会拒绝并提示改用分页审计。部署前和身份迁移后应执行此检查。
Alpha 模拟结算阶段保持现有订单与交付权限；真实资金操作上线前须按会话认证方式设计
加强认证。生产邮件发送、换绑旧地址通知及邮箱身份历史数据的重新验证仍待接入，
因此当前开发收件箱验收不能作为生产邮件安全验收。
若网络需要 HTTP(S) 代理访问 Coinbase，使用 Node.js >=22.21 并在启动 Node 进程前设置
`NODE_USE_ENV_PROXY=1`，同时提供可信的 `HTTPS_PROXY` 和适当的 `NO_PROXY`。
根目录的 `./start.sh` 会在检测到代理变量时自动为宿主机后端设置此开关。
`./start.sh` 会部署待执行迁移并刷新运行角色授权，但不会自动生成商品或清理数据库。
部署容器可用 `DATABASE_URL_FILE`
挂载连接信息，不能同时设置 `DATABASE_URL`；镜像与回滚见本地
`docs/api-deployment-runbook.md`。

`POST /api/health/live` 检查进程；`POST /api/health/ready` 查询数据库。
前端 Origin 必须等于 `APP_ORIGIN`（默认 `http://localhost:3000`），写请求携带会话 Cookie
和 CSRF token。每个响应带 `X-Request-Id`；错误和脱敏日志使用同一 ID。
汇率快照有效期为 1 小时，过期且供应商不可用时排序返回 `FX_UNAVAILABLE`。
指定单一 `currency` 且未提供 `quoteId` 的价格排序直接比较该币种原始金额，
返回 `quote=null`、`priceUsd=null`，后续页无需 `quoteId`；混合币种排序仍必须使用
真实汇率快照。显式提供 `quoteId` 时仍按指定快照处理。
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

### T03：收款确认与独立 BZTEST 快照

仅配置测试网且开启 Web3 时启用新订单入口。卖家先完成当前钱包绑定，再以
`purpose: payout` 申请独立重新认证和挑战；专用 EIP-712 domain 为 `Bazaar Seller Payout`，
类型为 `SellerPayoutConfirmation`。绑定签名和登录签名不能代替收款确认。挑战最多300秒、
一次消费；保存成功的确认不会每300秒过期，换绑／解绑在同一业务事务中撤销旧确认，
独立账本也清空payout。换回原钱包必须重新确认，旧请求回放只返回历史结果、不重新激活。

| 接口（`/api` 下） | 约束 |
|---|---|
| `GET /web3/config` | 公开测试资产配置，关闭时仅返回enabled=false；不含RPC或账本连接 |
| `POST /web3/payout/confirm` | 当前会话、Origin、JSON、CSRF、限流和专用签名；body为id/signature |
| `POST /web3/payout/reconcile` | 仅原有效会话完成原已提交payout；需原请求id、签名和CSRF，不是通用鉴权绕过 |
| `POST /web3/listings/:id/price` | 卖家以version/amount设置独立价格，生成新商品版本 |
| `POST /web3/orders` | listingId/version及Idempotency-Key；仅单件数字文件，原子预留并固定卖家/价格条款 |
| `POST /web3/orders/:id/terms` | 订单双方读取历史条款；不要求当前收款确认，关闭新测试网入口后仍可查询 |

BZTEST价格大于零、最多6位小数，以uint256范围内最小单位整数的十进制字符串存储。
普通报价仍独立保存，不进行任何汇率换算。发布数字文件时可额外提交
`testnetPrice: { amount: "1.000001" }`；编辑时用独立testnetPriceAmount字段。
已下单的一次性商品仍禁止内容编辑，只允许独立测试价和原有上下架操作。
其他合法内容修改会为新版本沿用原测试价；改为不支持的访问服务则不沿用，显式定价也拒绝。

`ListingTestnetPrice` 与 `TestnetOrderSnapshot` 按版本追加，运行角色只有SELECT/INSERT。
复合外键固定商品版本、价格原子值、链、代币、托管合约和确认钱包／绑定版本；历史行不改写。
迁移后需按既有部署流程刷新运行授权。新订单持有账户／商品锁再读取独立账本和有效确认；
未知账本状态一律拒绝。旧快照读取不重新要求当前钱包确认，避免换绑、改价影响历史条款。

原SIWE会话若因“业务提交成功、账本完成失败”被普通鉴权阻断，可用reconcile入口核对并完成
同一操作。该入口验证原sessionHash、已消费挑战、已提交操作、存储签名、当前绑定和准确修订，
只调用账本完成标记，不新增业务变更或延长授权；缺记录、其他会话、错误签名或CSRF均拒绝。
必须保留原请求上下文；原会话已撤销／过期或备份缺关键记录时仍需受控恢复，不自动解锁。

T03阶段建立订单条款快照基线；T04的本地意图能力见下节，真实托管履约
属后续阶段；新测试网订单不能调用旧模拟pay/deliver/accept/refund/裁决，也不会按服务器时间
被Alpha过期任务释放。既有模拟订单仍按原流程履约。不能将旧快照可读描述为支付替换已验证。

本地相关测试（先build，专用55435数据库）：

```bash
npm run check:backend
node scripts/with-web3-test-db.mjs node --test --test-concurrency=1 tests/testnet-listing.integration.mjs tests/testnet-http.integration.mjs tests/wallet-ledger-roles.integration.mjs
```

真实Sepolia RPC、钱包浏览器交互、实际代币／托管合约、完整灾难恢复和A29/A31/A32后续子项
仍待对应阶段验收。本地故障替身与API注入测试不代表已部署或真实链路通过。


### Web3 T04：本地支付意图与原子预留

`POST /web3/orders` 现在要求付款签名器及独立签发账本可用，将库存预留、订单快照、固定买家钱包及初始意图在同一事务提交，然后才签名。响应仍包含 orderId，并增加 intentId、固定 permit、JSON 可读 typedData、signature、status 和 protection。未配签名器返回 WALLET_UNAVAILABLE，不生成半成品订单。

- `POST /web3/payment-intents/:id/read`：重读或恢复原凭证，重签必须保持原摘要、keyId 和 1800 秒截止；不隐式创建新意图。
- `POST /web3/payment-intents/:id/cancel`：仅标记 cancellation_pending 并返回原撤销材料；不代表链上撤销，也不释放库存。
- `POST /web3/payment-intents/:id/reconcile`：由服务端观察器核对同一 finalized 区块的订单、意图和库存；RPC/账本/依据缺失返回503，库存保持保护。
- `POST /web3/orders/:id/payment-intents/replace`：提交 previousIntentId 与 Idempotency-Key。旧凭证已永久失效、订单未入金且重新核对通过后，生成唯一新意图。沿用原买家/退款/卖家地址、价格和库存元组，不要求卖家当前收款确认。
- `POST /web3/orders/:id/cancel`：全部历史意图均永久失效并在同一最终区块核对未入金后，才关闭订单并释放库存；稳定 stockId 不变，未入金取消不推进 generation。

以上均为 POST JSON，要求正常有效 Session、Origin、CSRF；取消、替换与关闭另需 Idempotency-Key。接口不接受客户端自报链上结果或覆盖金额/地址/库存。幂等结果不会恢复过期、撤销会话；迟到操作重新验证会话。

签发使用专用 PaymentPermit EIP-712 domain（Bazaar Testnet Escrow/version 1，绑定 chainId/escrow）。固定订单摘要按 orderId、stockId、generation、previousOrderId、buyer、refund、seller、token、amount、commitmentHash 的 ABI 元组计算，供 T06 共用；账户和意图 UUID 先按命名空间哈希，不将原始账户资料放入凭证。

运行角色对 PaymentOrderTerms、PaymentIntent、PaymentSignature、PaymentIntentRequest 只有 SELECT/INSERT；stockId、generation、前代不能由普通运行角色修改。独立安全库增加 PaymentLedgerIntent/Head/Resolution，签发前写入不可变摘要与稳定库存关联；业务库回退、摘要冲突、已终止旧意图或安全库不可用时停止签发。业务提交后失败只恢复原意图，独立结果先提交而业务投影失败时按原记录核对重试。

独立安全库首次部署使用更新后的 security-ledger/schema.sql；已初始化的 T02/T03 安全库须由所有者显式执行 additive security-ledger/payment-schema.sql，再刷新 wallet-ledger-grants。不能对已有库重新运行整份初始化，更不能替换 ledgerId/recoveryEpoch。仅增量 schema 文件和权限脚本入库，本轮没有升级开发库或实际安全库。

付款私钥仅由显式 WEB3_PAYMENT_SIGNER_FILE 指向的受保护文件加载（普通文件、权限0600，最多1024字节）；内容为 keyId（非零 bytes32）及 key（付款签名专用私钥）。没有自动生成或回退密钥，不得复用网站、交付或裁决密钥，不得提交文件。默认未配置，Alpha 启动行为不变。

T04 的 PaymentChainObserver 由 T07 在明确配置固定部署及有效检查点后接入；未配置时仍为null。核对须等待同一共同最终区块的完整投影，不以服务器倒计时或单源结果放行。T06已在本地验证实际T04摘要/ABI及撤销与入金的两种执行顺序，真实Sepolia交易竞争仍待验收。退款后业务库存代次推进及完整恢复归后续任务；T04只释放从未入金的安全取消订单。

验证：先 npm run check:backend，再通过 scripts/with-web3-test-db.mjs 运行 tests/payment-intent.integration.mjs；具体每项故障/并发/权限测试及日志见本地 T04 验收目录。尚无签发依据的旧测试网快照不能被自动补成可付款意图，保持保护以待受控恢复。

### Web3 T05：私有文件与隔离检查（本地）

本阶段新增独立私有文件链路，默认不启用；现有图片、Alpha交付引用和启动方式不变。
`ready`只表示本次检查通过且版本不可覆盖，不表示已发布、完成链上登记或允许买家下载。
真正的付款+登记双重finalized下载门槛在T08接入，文件保留／备份／删除台账恢复在T10落实。

认证JSON API：

- `POST /web3/private-files/upload-intents`：提交 orderId、purpose（delivery/evidence）、filename、contentType、byteSize，以及 Idempotency-Key；原子预占容量，返回敏感的一次性uploadToken及独立uploadUrl。
- `POST /web3/private-files/:id/complete`：空JSON，按固定uploadId幂等进入检查队列，不重复计数、不续期。
- `POST /web3/private-files/:id/status`：只返回上传者自己的元数据和状态；不返回对象密钥、原始存储URL或下载凭证。

上述接口要求Session、Origin、CSRF及限流。交付上传仅订单卖家；证据附件允许订单双方，容量计入提交者账户。只有测试网数字订单可用。证据互见、正式发布和复核授权属于T08，附件ready不会自动公开。

独立上传网关只接受PUT `/uploads/:id`、精确Origin和Bearer uploadToken，拒绝Cookie；二进制流不进入1MB JSON API，不使用无限制presigned PUT。文件源和网站使用不同主机名（本地localhost网站对应127.0.0.1网关），浏览器须省略credentials；GET不提供内容。T08下载还需attachment/nosniff与独立文件域验证，不能把本阶段无GET入口等同完整下载能力。

允许PDF、PNG、JPEG（20,000,000 bytes）与ZIP（500,000,000 bytes），每版一个对象；十进制单位。账户2GB、最多2个有效未完成意图、滚动每小时10次，意图原期限24小时；幂等重读不计数或续期。全局默认8GB／8个活动上传／每分钟20个新意图，检查并发1、队列4、排队最长300秒。预算指纹持久保存，多实例不能以不同预算悄悄绕过。历史ready文件继续计费，不因容量不足被删。

上传完成前仅有私有隔离对象。Garage适配器用最多8MB内存分片流式接收，入站累计字节，超声明拒绝；最终完成持有原上传状态锁。版本保存唯一opaque对象键、逻辑objectVersion、摘要、字节数、检查依据与固定用途；二次读取核对摘要后创建只读版本，不把同一内容复制成公开图片。该不可覆盖保证来自服务端一次写入协议与私有bucket权限，不宣称Garage提供WORM／S3对象版本锁。

配额在创建意图时预占；成功检查转换实际占用，不重复计费；失败、残留分片及临时对象只在中止和删除得到确认后释放。接收者记录PID、启动标识与boot/PID-namespace，未Ack停止或未证明同一进程退出前，清理保留容量；迟到的初始化／完成不能在释放后恢复对象。未知或远端owner不猜测已死。若停止Ack落库失败而owner仍存活，需恢复该owner确认或受控停止，不承诺自动恢复。

检查在单独只读、无网、无业务密钥的容器执行，明确4,000,000,000字节内存、无额外swap、1CPU、32PID、64,000,000字节临时tmpfs。完整任务120秒包含对象暂存、解析／AV、摘要重读；Docker仅获剩余预算。超时先取消读取并终止容器进程树，持久取消与owner Ack/精确本地退出共同防止迟到启动；清理scratch后才释放名额。宿主暂存受单文件500MB及全局检查并发约束；物理容量和真实部署预算仍需验收。

结构检查与恶意软件检查分别完成后才ready：

- Python标准ZIP/zlib逐条实际解压计量，CRC、结束标记、本地/中央头一致性校验；不解包执行源码。
- ZIP仅接受Stored/Deflate和明确解析的常见时间、UID/GID、Unicode路径额外字段；Unicode路径必须与已验证主文件名一致，拒绝ZIP64及未知额外字段。拒绝加密、嵌套压缩、路径穿越、符号链接/特殊文件，10,000条目、单条500MB、总2GB及100:1压缩比硬上限。压缩比不计注释/填充。
- Pillow完整解码PNG/JPEG，像素上限40M；qpdf结构检查并拒绝加密和主动内容。更复杂或不支持的文件保守拒绝，待真实样本调整，不能称为格式全兼容。
- ClamAV扫描原文件及容器内成员，病毒库超过7天或引擎/完整扫描不可用则拒绝。运行时不联网更新；受控构建刷新签名库并固定新镜像digest。ClamAV格式归一化也消耗递归深度，本地引擎预算10不等于允许嵌套ZIP；预算超限单独记MALWARE_SCAN_LIMIT，不当作clean或实际检出病毒。

上传／检查／删除审计追加保存。已检查版本、检查记录和审计仅SELECT/INSERT；运行角色不能改声明字段、对象键、用途或维护门禁。维护与完整恢复仍需运维授权。失败未完成文件清理不同于90/180天历史保留，不能误删ready、履约或争议引用。

本地构建及验收（仅使用专用隔离数据库和随机Garage项目，不迁移开发库）：

```bash
sudo docker build -t bazaar-web3-private-check:t05 backend/file-checker
cd backend
npm run check:backend
node scripts/with-web3-test-db.mjs node --test --test-concurrency=1 tests/private-file.integration.mjs
PRIVATE_FILE_CHECK_IMAGE=bazaar-web3-private-check:t05 node scripts/with-private-file-test.mjs node scripts/with-web3-test-db.mjs node --test tests/private-file-garage.integration.mjs
```

资源故障测试还需要临时control镜像，具体生成输入、镜像ID、命令及逐项结果保存在本地验收记录；默认未配置镜像的资源/存储测试会明确skip，不能计入通过。

手工启动需先准备专用隔离环境、迁移及runtime授权，私有bucket使用独立凭据，再通过受保护的PRIVATE_FILE_CONFIG_FILE提供uploadOrigin、endpoint、bucket、凭据文件路径、uploadKeyFile（32字节hex）、scratchRoot、budget和checker配置。所有秘密文件权限0600，不提交内容；checker.image必须为实际不可变sha256标识，资源预算由配置校验。不要复用开发库.env或把Docker socket／业务密钥挂进检查容器。

```bash
node --env-file=/absolute/path/to/isolated-private.env scripts/run-private-upload-gateway.mjs
node --env-file=/absolute/path/to/isolated-private.env scripts/run-file-check-worker.mjs
```

当前启动脚本仅支持本地loopback网关；公开独立文件域、TLS入口与部署身份属于部署门禁。检查监督器使用可信的容器管理权限，检查容器自身没有该权限。

本地已覆盖合成格式、恶意/畸形ZIP、真实ClamAV标准无害测试样本、10MB实际Garage流式流程和资源故障；不代表代表性500MB源码包、正式文件域、生产并发或文件绝对安全。另有本轮自建Node worker的SIGKILL后恢复测试；没有据此宣称T04全部资金进程崩溃、数据库连接中断、跨节点恢复或RPO/RTO已通过。

### T07：本地可恢复链上索引（未部署 Sepolia）

可选 `WEB3_CHAIN_DEPLOYMENT_FILE` 固定部署区块、T06 托管及代币运行时代码 hash、管理与裁决地址。启用实际付款签名配置时必须提供该文件；原有 Alpha 默认不启用 Web3。部署配置示例（地址/hash 使用实际隔离部署结果，不能照抄占位值）：

```json
{
  "deploymentBlock": "123",
  "escrowCodeHash": "0x<64 lowercase hex>",
  "tokenCodeHash": "0x<64 lowercase hex>",
  "administrator": "0x<40 lowercase hex>",
  "arbitrator": "0x<40 lowercase hex>"
}
```

```bash
# 明确提供隔离环境的 DATABASE_URL / WEB3_*；脚本不会自动读开发.env。
npm run build
node scripts/run-chain-indexer.mjs --initialize-recovery --once
node scripts/run-chain-indexer.mjs --once
node scripts/run-chain-indexer.mjs
```

仅全新部署、独立签发账本无历史且链/业务库均可证明为空时，所有者可用 `--initialize-fresh` 替代恢复初始化。它不能重置既有检查点或批准恢复；旧库、丢失映射及未入链签发记录需要保持 recovering，不能凭空槽重新签发。生产索引器要求业务与安全账本为不同数据库；测试多数使用55435随机独立schema，专用身份库拓扑和完整恢复另验收。

两源先核验各自最终头，在共同高度核验hash与祖先。每批最多128块、4096日志；历史订单按128条分页取得，合约状态最多8单并发读取，独立签发记录按128条分页核验，不将累计2048条当永久停机阈值；较长祖先证明每次最多512步，未完成时保留有界内存证明进度并暂停业务推进。历史状态、代码和余额使用 EIP-1898 `blockHash + requireCanonical`，不回退到latest；全部事件、receipt及同H状态一致后，事件去重、资金/库存投影和进度才在同事务提交。完整范围内先交付后退款只公开退款结果；终态仍保留首次登记。已接受最终区块矛盾进入isolated，不自动重写终态。

暂态交易观测不影响资金；`POST /web3/orders/:id/transaction-attempts` 仅记录txHash线索，`POST /web3/transaction-attempts/:id/refresh` 可更新unknown/included/replaced/reverted/finalized。交易finalized也不等于订单付款成功。接口复用登录、Origin/CSRF、限流及幂等保护；钱包拒绝、RPC暂时查不到或交易替换均不会据此关闭支付意图。

T07保持所有ready文件不可下载；完整资金投影可标识库存应占用/未登记退款/登记后禁售/已售，但业务库存继续保护。T08才接精确版本映射、授权及有完整私有依据的退款代次激活。检查点缺失/恢复/隔离、已核验暂停新入金或独立签发依据缺失时，停止相应新签发；暂停不消除旧签名和用户直接调用合约退出的权利。

```bash
# contracts/需先npm ci、npm run tools:solc并执行T06构建，Anvil1.5仅安装本目录。
node scripts/with-web3-test-db.mjs node --test --test-concurrency=1 tests/escrow-projector.integration.mjs tests/transaction-attempt.integration.mjs tests/chain-local.integration.mjs tests/local-escrow-fixture.integration.mjs
```

本地Anvil背后的两个回环代理共享一个EVM，只证明合约/传输/故障处理，不证明独立供应商或以太坊PoS最终性。验收分别记录双源故障替身、真实本地合约事件、提交前后Node子进程SIGKILL及重建比对；真实Sepolia、网页钱包、大历史/并发容量、数据库/对象一致恢复与RPO/RTO仍未验收。恢复不会补出私有文件、账户或签发记录，也不开放下载。

T07复核补充：每个已接受H保存不可变订单/库存摘要及全局快照，重复范围比较完整事件集合；历史H未保存投影摘要则保持待核对，不假称重放通过。独立最终裁定先核验区块祖先及当时事实，提交锁内再验账本水位；冲突不能复活取消/终态订单。公开交易尝试响应使用字段白名单，不返回RPC URL、供应商Key路径或内部账本字段。


### T08 本地私有文件授权

`WEB3_DELIVERY_SIGNER_FILE` 为独立、仅拥有者可读的 `{key,keyId}` JSON，不能复用付款 key；服务在两路 RPC 同一最终区块核对交付 signer。可选配置缺失时不签交付凭证，不生成临时 key。`PRIVATE_FILE_CONFIG_FILE` 的独立 `uploadOrigin` 同时承载不带 Cookie 的短期附件下载；通过 `scripts/run-private-upload-gateway.mjs` 启动。主 API 只接受 POST 鉴权授权，文件仍私有，不复用公开图片路由。

首次凭证在签名前提交精确不可变版本映射，以零左填充 UUID 为 bytes32 版本/凭证标识；文件清单采用规范字段及随机 32 字节私有盐做 SHA-256 承诺，原哈希、盐及对象定位不上链。合约实际接受哪份凭证，只有该版本可下载；补交需要原订单固定卖家专用 EIP-712 授权。补交和新链接与完整退款投影共用锁，历史记录不意味着可下载。旧链接固定签发后 300 秒到期，退款不能收回已下载数据或保证终止在途传输。已建立授权不依赖持续 RPC 连通，恢复或映射不完整时拒绝猜测。

双方可发布有明确互见确认的文字及已检查附件。证据独立接口不开放原交付文件字节；退款不自动关闭证据读取。管理员仅在有订单范围、有效期的 `ReviewAuthorization` 时可复核。该授权表运行时只读，由部署所有者受控配置；复核结案/重开有审计，无裁决或资金权限。T10 保留、删除台账与完整恢复尚未验收，不能从本地下载检查推断容量、灾难恢复或公开部署已通过。

### T08-R：独立退款退出记录与安全重售（本地）

退款恢复复用独立 `wallet_security` 库，新增只允许运行时 SELECT/INSERT 的 `PaymentLedgerRefundExit`，不放入业务 Prisma 备份。记录链、托管、原订单、库存及原/后代次、实际入金意图、退款事件交易与日志位置、共同最终区块和持久未交付证明；证据摘要、不可变发行记录和唯一约束共同检查一致性。账本记录已核验事实，资金仍以链和可信合约为准。

索引 worker 在完整 H 投影提交后执行恢复：双源检查收据/事件、在同 H 读取合约永久保留的首次交付字段、独立退出记录先提交，再在业务 chain/listing 锁及独立发行 head 锁内按原订单/原代次恢复库存。仅日志缺失不构成“未交付”证明。已登记退款保持禁售。重复运行、响应丢失、业务回退均可重试；已被后代占用的库存不会被旧记录释放。业务 `RefundInventoryTransition` 只是可重建回执，不能代替独立依据。

未付款后代需要区分两套代次：业务已准备 N+1，但合约在真正入金前仍保留退款前代 N 的占槽。到期、撤销、替换和关闭必须同时核验原退出记录及同 H 的前代永久状态，不能把前代占槽当作空槽，也不能因此永久卡住预留。真正入金由合约检查前代及代次后推进。

升级顺序：先由独立库 owner 配置既有 `WEB3_SECURITY_LEDGER_OWNER_URL_FILE`、`WEB3_SECURITY_LEDGER_RUNTIME_ROLE`、**既有** `WEB3_SECURITY_LEDGER_ID`，运行 `node scripts/upgrade-refund-ledger.mjs --confirm-independent-ledger`；再应用业务增量迁移和运行时 grants，最后启动本版 API/索引 worker。该升级验证数据库名、现有身份、表定义与约束，幂等重跑不重置 recovery epoch、钱包绑定、发行或退款历史。未升级、身份不符或历史不完整时停止相关推进。本轮仅在独立测试环境执行升级；开发库未迁移。

回退前先停止 Web3 新发行与恢复 worker，保留所有独立历史和业务证据；可以维持 Alpha 模拟交易，但不得用旧版代次逻辑继续处理本版后代意图，也不得通过删除退款账本回退。恢复后的重新开放仍需 T10 的隔离、私有映射、资金与权限核对。

本地测试：`node scripts/with-web3-test-db.mjs node --test --test-concurrency=1 tests/refund-recovery.integration.mjs tests/refund-ledger-schema.integration.mjs`。覆盖真实 T04/T06/T07 入金、未交付退款、到期/替换/撤销、下一代入金、五个实际 SIGKILL 阶段、测试连接终止、真实业务 schema 备份恢复、独立记录丢失/冲突和下一代已占用。测试包括同一 PostgreSQL 实例的随机隔离 schema及升级专用独立数据库；生产 worker 仍要求业务与安全库独立。实际备份恢复只验证这条业务/账本链路，不等于完整私有文件灾难恢复或 RPO/RTO 达标。

### T09 页面只读接入

订单列表/详情新增 `settlementMode` 以分离模拟与测试托管页面。现有 `POST /web3/orders/:id/terms` 在原快照字段之外返回 `payment`（原固定地址等不可变订单元组）与最新 `intentId`。接口仍仅订单双方可读；这些历史元数据不是有效付款授权，页面发送前必须通过已有 intent/read 重验，下载必须通过 T08 授权接口。没有新增数据库迁移或后台代持用户密钥。

### T09 身份与真实本地闭环

Google钱包重新认证start可选locale，首次流程固定；HTML callback清理一次性Cookie后只重定向到APP_ORIGIN/{locale}/wallet/reauth，原JSON客户仍获原id/expiresAt、不续期。客户端在固定完成页以原Account/Session、目的、版本和原到期挑战签署专用WalletAction或SellerPayoutConfirmation。SIWE独立登录仅接受当前有效绑定钱包，复用现有Session。

状态元数据（delivery/read、private-files/status、evidence/read）单独采用60秒固定窗口、每scope每账号30次/每IP120次；签名、上传及链接授权原额度不变，认证、CSRF和审计不变。30读后31次429不会耗尽写授权额度。IP并发与容量另验。

`npm run test:e2e:web3:full`串联真实API、隔离PostgreSQL/Garage、Docker checker及Anvil索引；Google提供方替身、Node钱包签名桥，两RPC同一节点，不能冒充真实外部验收。`test:e2e:web3:profile`为显式环境预检，不加入默认test:db发现范围。生产DeliverySigner仍默认从受保护配置读取，内部依赖适配与PaymentSigner一致，不提供HTTP注入入口。

完整证据位于本地忽略目录docs/superpowers/evidence/2026-11-12-t09-full-local；仅定向子用例通过，A01–A32、Sepolia、扩展、独立账本自身防回退、全量恢复及公开部署继续待验收。

### T10 第一批：独立账本自身回退保护（整阶段未完成）

非注入的 Web3 API 和索引器现在要求 `WEB3_SECURITY_WITNESS_DIR`。目录须预先创建、属于运行用户、权限0700、绝对真实路径且不是符号链接，并且位于**不会随业务库、安全库或其旧备份恢复的持久存储**。所有钱包、付款签发、退款账本事务共同使用这一目录。摘要覆盖10张权威表，包含永久claim、prepared操作、完整付款签发/失效/退款依据；摘要按页计算，不将全部账本放入内存。事务强制至少RepeatableRead；十表ACCESS SHARE锁阻止并发DROP/TRUNCATE；并发owner DML不进入本事务快照，因此不会被当作本次写入重新封存，下一次核验发现不符即拒绝。摘要固定UTC/ISO及C排序，不受连接时区影响。owner备份恢复仍须先停止所有使用者，这不是授权在线任意改写账本。目录不可由备份恢复脚本覆盖。

首次部署：先按既有脚本初始化一个全新空安全账本；停用所有访问该账本的旧版本进程，创建0700目录。使用受保护的owner URL文件配置 `WEB3_SECURITY_LEDGER_OWNER_URL_FILE`、`WEB3_SECURITY_LEDGER_ID`、`WEB3_SECURITY_WITNESS_DIR`，从backend执行：

```bash
npm run build
node scripts/initialize-ledger-witness.mjs --confirm-empty-independent-ledger
```

该命令不读取.env、不自动创建目录、不接纳非空历史、不重置已存在见证。已投入使用的非空账本**不可删除历史后初始化**；必须保持停机，另行审阅受控升级/导入依据。旧版仍可运行非Web3 Alpha；不得将本版Web3回退到不读取见证的旧进程。

账本变更在数据库提交前先持久化pending前后摘要，提交后持久化新head，再清理pending，最后返回成功。目录与文件均fsync；跨进程锁不会根据PID猜测失效。正常失败且未形成pending不推进head；数据库提交不明、见证写失败、SIGKILL留下的锁/pending均fail closed。失败响应不表示数据库一定未提交。**禁止自动删锁、删pending、重建head或用旧备份重新封存。**应停止所有使用者、保存故障证据，恢复与最新可信见证匹配的完整独立账本；若仍有pending，保持隔离并逐项核对，首批未提供通用自动修复工具。

退款恢复在任何库存早退前核验账本；失败则将该scope扫描状态和相关库存置为保护。恢复匹配的账本只恢复可信依据，不自动开放业务checkpoint。普通测试依赖注入可绕过生产接线，因此无见证的历史测试不能作为本能力验收。

测试：`node scripts/with-web3-test-db.mjs node --test --test-concurrency=1 tests/ledger-witness.integration.mjs tests/refund-recovery.integration.mjs tests/web3-recovery.test.mjs`。`check-web3-recovery.mjs <evidence.json>`仅评估真实检查报告，不授权开放；缺关键依据为blocked，部分恢复没有完整RTO，只有完整检查且基础设施/独立RPC前提满足才评估24小时/4小时目标。工具不验证报告真实性，调用者需链接实际证据。

这是本地独立目录防数据库回退验证，不证明见证卷自身不被回退、WORM/远端耐久、容器重建后的挂载或多主机锁；多API部署须共享同一具备所需POSIX锁/rename/fsync语义的目录，部署前实测。全账本摘要和串行锁的性能尚未验收；本轮不提供公开部署容量背书。第二、三批已补充保留/删除台账、加密一致备份、14天到期清理及本地限定恢复；真实独立介质与完整RPO/RTO仍待验收。


### T10 第二批：私有文件保留、加密备份与隔离恢复

本批仍是本地实现，T10 整体及公开测试网部署尚未验收。配置 `PRIVATE_LIFECYCLE_CONFIG_FILE` 后，API、交付签发、补交发布、证据与索引器共用独立生命周期账本；缺失、回退、未知 pending 均保持保护。未配置的历史 Alpha 不获得这一恢复能力，不能把它用于有此保障要求的 Web3 部署。

业务迁移 `202611140001_private_lifecycle` 只增加删除门禁和恢复状态；普通 API 对两表只读。独立账本不在业务 Prisma 迁移或备份内。部署所有者先创建独立 `private_lifecycle` 或 `wallet_security` 数据库、预建受限角色和专用 schema，再使用 `scripts/provision-private-ledger.mjs --confirm-independent-private-ledger` 初始化全新账本；该命令不能修复、清空或重新封存已有账本。运行角色仅有 Meta/Event 的 SELECT 和 Event 的 INSERT。账本、见证、加密密钥均须独立于业务恢复点保护。

普通文件从首次可靠的结算/退款核验起保留90天；争议相关文件从链上终态核验与最新复核结案的较晚时间起保留180天，多条件取最晚期限。未终结、复核重开、引用或映射缺失时保护。删除先写独立 claim，再在业务库设门禁，确认对象删除、写独立完成记录后才释放配额。跨库部分失败保留保护并幂等重试，不按计时自动解除 claim。新的证据引用、补交和下载不得绕过门禁。底层桶启用/曾启用版本或无法查询版本状态时，维护拒绝声明物理删除成功；副本清理仍需部署验收。

以下命令从 backend 执行，先 `npm run build`，再通过受控环境/保护文件提供 `.env.example` 中列出的参数；不要将 owner URL 或密钥放入命令行、日志或仓库。

```bash
node scripts/run-private-retention.mjs --once
node scripts/backup-web3-state.mjs --create
node scripts/backup-web3-state.mjs --expire
node scripts/restore-web3-state.mjs --confirm-isolated-restore BACKUP_UUID
```

备份使用 PostgreSQL 原生 exported snapshot 与不可变对象清单；逐对象核对字节数/摘要，AES-256-GCM 加密数据库、对象和清单，独立账本提交成功后才成为可用恢复点。每份为独立全量，创建起14天到期，不随恢复续期。备份调度器每日运行 create/expire 并监控失败仍是部署前置条件；“已有命令”不代表24小时RPO已经成立。原生 pg 工具需预先安装；当前路径在本地回环 PostgreSQL 验证，远程 TLS/客户端证书参数须另行接入核验，不应用于未经核验的远程数据库。

恢复必须停止原业务写入者，使用全新 `bazaar_web3_restore_<随机十六进制>` 数据库及独立私有桶，不覆盖业务库，也不连接失效源库。命令只恢复至 isolated，不能开放。它作废旧会话、未用身份挑战及旧下载 epoch，应用最新独立删除记录与钱包永久归属，缺失依据列入 missing；链上补扫不能补造私有文件、证据或未入链签发。

受控开放使用 `PrivateRecoveryService.reconcile → validate → open`：同一最终区块资金核验、精确首次/补交版本与证据摘要核验、账本新鲜度、删除水位及并发门禁均须通过。开启动作与删除账本变化互斥，响应丢失仅重试原 runId。未提供通用线上开放 CLI；隔离浏览器演练由受控协调器执行开放后再验证真实 HTTP 权限。不能通过手改 status 或使用报告评估脚本代替核验。

本地验证命令（不迁移开发库）：

```bash
node scripts/with-web3-test-db.mjs node --test --test-concurrency=1 tests/private-retention.integration.mjs tests/private-backup.integration.mjs tests/private-recovery.integration.mjs
T10_RECOVERY=1 node scripts/with-web3-test-db.mjs node scripts/with-private-file-test.mjs node ../frontend/scripts/check-web3-full-browser.mjs
```

浏览器使用新建结算/退款订单、真实本地 API/PostgreSQL/Garage/文件检查器/Anvil，Google 交换与网页钱包由明确替身驱动，两路 RPC 指向同一 Anvil。恢复为原 API 停止、隔离桶对象丢失、新数据库导入场景；原源库离线保留供取证，未模拟整机/密钥丢失。独立账本和密钥不在故障范围，因此该结果不能证明独立介质恢复、真实供应商、全套灾难恢复或4小时目标已达标。

仍需验收：见证介质自身回退与 pending 受控恢复；崩溃留下的恢复临时副本清理；独立存储及备份到期执行/审计；代表性大文件、并发与摘要锁预算；真实 Sepolia 双供应商/Google/扩展；完整开放运维流程与恢复材料演练。保留和备份到期不等于已证明所有内部副本物理擦除。

### T10 第三批：本地模拟的第三处材料与受控恢复

本批将钱包/私有账本及见证的共同回退纳入恢复门禁。验证公钥和当前检查点配置来自第三处保管位置，由受信任的启动配置固定，不能从业务旧备份或待解密包中自选。角色包只包含已授权的运行材料，不包含裁决多签成员私钥。尚未接入远端保管、WORM、完整运维恢复 CLI 或真实独立 RPC，不能据此宣称 T10 整体通过。

启用 `WEB3_RECOVERY_PROFILE=controlled` 后，必须同时提供钱包与私有账本的检查点描述文件。钱包描述通过 `WEB3_SECURITY_CHECKPOINT_CONFIG_FILE` 指定；私有生命周期配置增加 `checkpointConfigFile`。每份公开描述包含 `environmentId`、`checkpointFile`、`historyFile`、`publicKeyFile`；钱包描述另用 `pairedPrivateConfigurationFile` 固定配对的私有描述，旧材料包不能选择旧的私有检查点。描述、公钥、检查点、历史承诺文件及可替换它们的目录边界都不能由运行 UID 写入；共享验证会检查实际写权限、所有权、符号链接和父目录，根用户不能作为这一受控运行身份。复制到应用自己的可写目录不构成可信保管。已有数据库门禁中的受控标记也不能靠遗漏启动参数解除。

检查点由独立保管角色用专用 Ed25519 密钥签名，绑定环境、账本、namespace、递增序号、完整摘要及历史承诺；验证公钥不接受包自带值。较大序号本身不是后代证明：钱包永久归属/事件/支付意图/资金退出等不可变记录、私有账本事件必须保留检查点承诺的成员，元数据也须匹配。历史承诺只保存行摘要，不公开账本正文。当前实现每份历史最多4,000,000字节、累计40,000行承诺，超预算拒绝，不据此认定生产容量已验收。

保管角色使用 `publishWitnessCheckpoint` 在所有者独占锁下采集真实已提交记录；不能用摘要补出丢失记录。发布配置路径由可信启动环境固定。发布新基线、切换描述及重启核验仍需受控操作；持续发布调度、切换和远端耐久尚待部署验证。两个本地位置彼此匹配不代表最新：第三处保留 C2 时，共同回退到 C1 仍应拒绝；三处一起回到 C1 且没有外部更新记录时，本地方案无法证明 C2 曾存在。

`stageWitnessRecovery` 是所有者离线维护函数：精确比较独立签名检查点的 before/after 和数据库记录，只生成全新候选目录，保留原 head、lock、pending，不修改原历史，也不开放应用。所有者事务先获得独占锁，再读取当前已提交状态，避免旧快照误认成功。提交前/后的真实 SIGKILL 分别验证明确的回滚/提交结果；不能凭 PID 消失或删除锁猜测事务结果。

角色材料采用独立的 manifest/config/payment/delivery/access/ledger-records 包装密钥，认证环境和配置版本。普通材料单文件64KiB、账本记录单文件1MiB、最多16个文件、总量16MiB；它们是恢复材料限制，不是交付 ZIP 的限制。解密先消费300秒内、绑定恢复编号/C2/环境/配置版本/包摘要/目标目录的一次性授权；失败不能自动退回未消费状态。只恢复到空的私有目录，文件、密钥、环境或版本不符时拒绝并清理未完成明文。消费记录保存在第三处保护域，不随业务回退。

本地演练以正常结算和争议退款两类新订单完成：保存 C1 后退款得到 C2，实际恢复业务库/独立账本/见证到 C1，保持第三处 C2，先证明被拦截；新保管进程从密文恢复完整记录和运行材料，不能读取已隔离的原密钥目录。已授权的安全代次更新后，由保管角色发布绑定 C2 前驱的 C3，再启动独立运行用户的全新 API。网页登录、旧钱包拒绝、退款下载撤权和证据接口均走实际 API/数据库/Garage/本地链。运行用户只验证公开信任材料，不能读取包装/签名私钥或改写保管目录。

```bash
# 仅专用55435测试环境，不能替代真实部署演练
T10_RECOVERY=1 T10_CUSTODY=1 node scripts/with-web3-test-db.mjs node scripts/with-private-file-test.mjs node ../frontend/scripts/check-web3-full-browser.mjs
node scripts/with-web3-test-db.mjs node --test tests/controlled-witness-recovery.integration.mjs
```

本地文件夹与同一主机上的不同 UID 只是角色/故障模拟，密钥包装与签名保管仍依赖该主机和受信任保管者。独立介质、防三方共同回退、保管者本身失联、真实供应商和代表性数据恢复继续待验收。完整结论、时间、原始公开签名与测试来源见本地忽略目录 `docs/superpowers/evidence/2026-11-14-t10-controlled-recovery/acceptance.md`。


### T10 本地发布间隙演练（第四批）

本批提供显式接入的本地发布组件及故障测试，不自动给已有部署或开发库启用发布，也不自动重新登记已有见证。T10 整体仍待验收，`targetsMet=false`。第三批恢复结果不会因本批组件测试而升级为独立介质能力。

- `LedgerWitness` 的第六个参数可传 `{ environmentId, notify }`。新建空账本时在同一事务排入序号 0 的完整基线；每笔受保护变更在原事务中排入连续序号、摘要和闭合表的完整规范记录。钱包绑定、退款账本与私有删除事件共享这条见证路径；只读操作不排队。选择启用后，见证持久绑定发布环境，遗漏配置、记录断档和材料缺失均拒绝操作。
- `publication-outbox/schema.sql` 为独立账本所有者使用的增量 DDL，新建账本的两份 schema 同步包含它。运行进程不能执行 DDL；新表运行权限仅 SELECT/INSERT。已有非空账本不能通过打开参数隐式登记，需要后续受控迁移方案。回执与待发布表不纳入账本摘要，避免循环摘要。
- `LocalCheckpointPublicationStore` 由受信任保管进程使用。先持久保存 AES-256-GCM 加密的完整记录，再原子发布 Ed25519 签名检查点。检查点绑定环境、前一签名文档摘要、各流截至本次的序号/摘要及配置版本；公钥由外部固定。只有目录同步成功并回读、解密、验签和重算账本摘要后才返回确认，幂等及并发重试同样执行同步与回读。
- `PublicationWorker` 启动即补发，提交后 `notify()` 唤醒，每 `60000` 毫秒核对一次已提交与已回读确认的位置。超时、回执丢失保留待发布记录；同序号同内容返回原检查点，不推进第二次。同序号冲突、断档、加密材料或已确认历史缺失时停止推进。发布异常不撤销已提交的链上退款。
- `LocalRecoveryAuthorizationJournal` 将消费事实留在不同的预配置私有目录。`PublishedRecoveryConsumptionGuard` 把每个 nonce 作为不可变单事件流（序号 0），通过全局递增的签名检查点串联并纳入位置向量；nonce 文件本身即持久待发布记录。签名保管回读前不得继续解密，补发不会重新执行已消费授权。原消费日志回退后，保留的签名记录仍拒绝重用；缺失的消费历史需要受控恢复，不能自动忽略。
- `restoreAuthorizedCustody` 显式使用 `requireConsumptionGuard: true` 和上述 guard 才启用本批受保护路径。历史调用保持兼容，不能把未传保护参数的旧入口称作本批能力。签名/加密密钥仅归保管进程，不能注入网站运行账户。

第四批当时只验证组件。下方第五批已补齐本地常驻进程、服务入口和非空账本登记；跨主机唤醒、系统服务托管、真实保管服务及完整部署接管仍待验收。需要隔离本地环境执行：

```bash
cd backend
npm run test:recovery:publication
```

测试使用专用 Web3 测试 PostgreSQL（默认 55435）及随机 schema，不读取持久开发库。包含事务提交前后 SIGKILL、保管提交后回执前 SIGKILL、丢回执重试、完整钱包/退款记录、删除事件、授权消费回退和目录同步故障。容量限制是本地初始保护：单快照最多 40,000 行、原始行内容 16 MiB；加密包另限制序列化后 16,000,000 字节、每条链 1,000 个检查点，达到限制即隔离，不能据此声称生产容量达标。

恢复时若原主机及未发布站内记录丢失，仅剩 C2，必须显式标记站内历史完整性未知；`offchainHistoryVerified` 门禁返回 false 时发布协调器保持隔离。链上退款补扫不能证明钱包换绑历史完整，不能据此解除身份保护。检查点摘要不能补出未留存的记录。真实部署还必须将该门禁接入完整开放检查；本批没有自动放开任何业务入口。


### T10 常驻发布与恢复开放入口（第五批本地接入）

API、索引器与私有生命周期现在可显式接入发布；主环境默认不启用。设置 `WEB3_PUBLICATION_RUNTIME_CONFIG_FILE` 指向只包含公开定位信息的配置：`environmentId`、`configurationVersion`、`recoveryRunId`、`walletLedgerId`、可选 `privateLedgerId`、`wakeSocket`、`publicKeyFile` 和 `openingFile`。文件及其父目录必须由独立保管身份控制，网站 UID 不能改写或替换。不要在该配置中加入签名私钥、包装密钥或数据库 URL，解析器会拒绝额外字段。

独立保管进程通过 `WEB3_PUBLICATION_CUSTODY_CONFIG_FILE` 读取自己的 0600 配置：环境、配置版本、`custodyDirectory`、`publicKeyFile`、`privateKeyFile`、`encryptionKeyFile`（原始 32 字节文件）、`ledgerSources`（`namespace/ledgerId/urlFile`）、可选 `wakeSocket/wakeSocketMode`、`baselineCheckpoints` 及 `authorizationJournal`（`directory/usedDirectory/recoveryId/checkpointHash`）。每个密钥或 URL 文件都需独立保管身份所有且为 0600。消费日志参与共享向量时必须配置它，不能因为网站数据库没有该行就忽略签名消费历史。

```bash
cd backend
npm run build
WEB3_PUBLICATION_CUSTODY_CONFIG_FILE=/absolute/owner-only/config.json node scripts/run-checkpoint-publisher.mjs
# 一次性核对并退出：同一命令追加 --once
```

进程启动补发、提交唤醒和每 60000 毫秒核对共用同一持久队列。Unix socket 只请求唤醒，不接收业务记录或签名参数；连接失败不撤销原事务。socket 默认 0600，配置 0660 时需预先为受信任服务组设置合适的目录遍历权限（例如独立保管者所有、组可遍历但不可写的目录）。网站进程不得因此获得密钥目录权限。服务拒绝删除预先存在的未知 socket；SIGKILL 遗留 socket 时需所有者确认并处理，或使用受控的新 socket 配置，不能把此情况记作自动恢复能力。

**已有非空账本不能直接改参数重新初始化。** 在维护窗口停止旧消费者、完成并提交独立所有者 DDL/权限更新后，使用 `enrollPublication`：核对预先固定的 C2 签名、完整历史与真实数据库，原序号和原见证文件不变，只生成新候选见证。保管配置以 `baselineCheckpoints` 固定旧锚点，后续签名记录保留其哈希、序号和摘要，不从零重建。确认完整候选后才切换运行配置；记录不完整保持保护。

已有第四批发布表可单独应用 `publication-outbox/fence.sql`，新建账本的 schema 已包含它。重新执行相应最小权限授权。该所有者 DDL 必须在升级后的消费者重新准入前提交；不能期待未升级的旧二进制理解新保护。登记使用非 MVCC 序列 `LedgerPublicationFence`，运行角色仅有 SELECT，无 USAGE/UPDATE。即使旧请求的 Repeatable Read 快照早于登记提交，也能观察激活并被拒绝。登记回滚不会清除激活，必须通过受控重试处理，不自动开放旧配置。

**恢复开放声明是独立保管者的结果，不能从旧业务备份选择。** JSON 为 `{payload, signature}`，Ed25519 签名域是 `bazaar-publication-opening-v1\n` 加现有 canonical stable JSON。payload 包含：`version:1`、`kind:publication-opening`、环境、配置版本、本次 `recoveryRunId`、钱包及可选私有账本 ID、核验检查点哈希，以及 `offchainHistory:unknown|verified`。它是当前运行配置的站立开放声明，不是复用登录、付款或交付签名，也不会自动证明记录完整。

恢复顺序为：保持 unknown → 离线重建与验证完整记录 → 保管者核验结果并签发绑定本次恢复的 verified 声明 → `PrivateRecoveryService.open` 再验证并开放。`open` 在进入和最终事务内都检查声明；站内数据库的 active 标记不能绕过它。只有 C2、无法核实之后是否换绑时不得签发 verified；退款补扫不改变这条规则。API 会逐请求重新检查声明，未知/缺失/篡改/恢复编号不符均返回 `WALLET_UNAVAILABLE`。存活检查仍可成功，但就绪检查和业务入口保持隔离。新文件授权和下载入口同样执行检查；正常清理被暂停，受控离线恢复核对仍可运行。

本地服务验收命令（专用 PostgreSQL 55435，需当前主机可用的免交互 sudo 来切换测试 UID）：

```bash
npm run test:recovery:services
```

包含真实 60 秒漏唤醒核对、独立子进程重启、非空 C2 受控登记、旧快照/登记并发、不同 UID 的实际 HTTP 钱包绑定与发布、C2 账本/见证回退后的拒绝，以及实际索引器和文件生命周期脚本的受限角色接入。不同命令也须串行使用同一个测试数据库，避免全局见证 advisory lock 导致维护检查正确拒绝并行测试。

这批没有部署系统服务单元或修改 `start.sh`，没有完成生产接管、真实 RPC/钱包扩展、Garage 实际大文件或整机恢复演练。HTTP 使用 Node 钱包签名和 EOA 检查替身；脚本测试在 unknown 状态拒绝 RPC，因此不计为链上补扫通过。文件生命周期入口可创建实际私有账本待发布记录，但构造对象客户端不代表存储可用性已验证。T10 整体继续待验收、`targetsMet=false`；本批 RPO/RTO 均为 null。

第五批最终检查：后端 289/289、服务组合 29/29、相关数据库回归 51/51；受限业务/钱包角色的 HTTP 又独立复跑 1/1。结果有重叠。验收报告见本地 `docs/superpowers/evidence/2026-11-15-t10-service-publication/acceptance.md`。
