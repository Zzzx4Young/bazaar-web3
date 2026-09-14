# Bazaar 后端

独立 NestJS/Fastify + Prisma PostgreSQL 包，已完成内部 Alpha 的认证、商品、订单、交付、退款恢复和前端联调。当前验收见[阶段记录](../docs/backend-stage-report.md)。

## 本地运行

Node 22.12+（本轮使用 22.23.1），npm 10.9.8。在本目录执行：

```bash
npm ci
npm run build
cp .env.example .env
# 按下方角色初始化说明准备开发库，填入运行账号密码。
npm start
```

默认监听 `127.0.0.1:3001`。`POST /api/health/live` 表示进程可响应；`POST /api/health/ready` 执行真实数据库查询，失败返回 503 且不返回驱动错误详情。启动要求数据库可连接；SIGINT/SIGTERM 触发 Nest 关闭钩子，释放 Prisma 连接池。每进程连接池上限 5，连接与语句超时均为 3 秒。

每个响应返回 `X-Request-Id`；客户端可发送受限格式值，否则服务端生成 UUID。错误体包含同一 `requestId`。默认请求日志只记录方法、路由模板、状态、耗时和稳定错误码，不记录 body、headers、原始 URL 或私有值，完整边界见[安全日志契约](../docs/backend-observability-contract.md)。

启动不会迁移、seed 或清理数据库。首次使用先按 [C1 角色与迁移说明](../docs/backend-core-contract.md#数据库角色)创建迁移/运行账号，以迁移账号部署全部已检入迁移并授权，再以运行账号启动。日常开发只需一个持久化 postgres 容器；另外两个测试容器按需启动。不能把健康检查作为业务数据正确性的证明。

I8-2 提供 `backend/Dockerfile` 的 `runtime` 与 `migrate` target，以及
`infra/compose.api.yaml`。部署环境使用 `DATABASE_URL_FILE` 挂载完整数据库 URL secret；不能
同时设置 `DATABASE_URL`。镜像构建、迁移、启动、检查和回滚步骤见[部署手册](../docs/api-deployment-runbook.md)。

宿主机安装 PostgreSQL 17 client 后，可在本目录执行 `npm run db:psql` 进入默认只读观察
连接；显式追加 `-- runtime` 或 `-- migrate` 才切换到对应本机私有配置。启动器校验目标
必须是 loopback `bazaar_dev`，密码只通过 `PGPASSWORD` 传给子进程，不出现在参数中。

本地观察入口先执行 `npm run db:observer:setup`：它创建无成员关系的 `bazaar_observer`、
`bazaar_observe` schema 和 16 个脱敏视图，并写入 Git 忽略、权限 0600 的
`.tmp/i8-observer.env`。观察视图不暴露登录名、密码/会话哈希、自由文本、收件信息、交付
引用/提取码、幂等键或汇率 JSON；角色默认只读、语句与空闲事务超时 3 秒。命令只允许
本机开发库，目标对象或私有文件已存在时拒绝接管。

应用 schema 变化后，由迁移角色执行 `npm run db:observer:grant`，以事务方式重复创建视图、
撤销原始 schema 权限并重新授予安全视图读取。通用环境先由管理员执行
`infra/scripts/create-observer-role.sql`，再执行该命令。

若仅限本机的 `bazaar_dev` 已有正确的受限角色和 schema，但角色密码已丢失，可在确认没有其他进程依赖旧密码后显式运行 `node scripts/recover-local-role-credentials.mjs --confirm-local-rotation`。该命令要求通过 `ADMIN_DATABASE_URL` 提供 loopback 管理连接，复核角色权限和 schema 所有权后原子轮换两个密码，并创建权限 0600 的 `.tmp/i7-migrate.env` 与 `.env`；文件已被 Git 忽略，命令不输出密码或连接串。它不创建角色/schema，不适用于共享或远端数据库。

## 验证

```bash
npm run build
npm run typecheck
npm run lint
npm test
# 仓库 Compose postgres-test 已启动时，读取本地已忽略的测试密码文件：
node scripts/with-test-db.mjs
# 启动 postgres-validation 后，从空的独立持久数据库演练 I7 环境并重启验证：
node scripts/with-i7-environment.mjs

# 在同一专用服务创建隔离源库/恢复库，验证 custom backup、权限与重启持久性：
npm run test:backup-restore

# 已构建 bazaar-api:ci 和 bazaar-api-migrate:ci 且 postgres-test 已启动时：
npm run test:deployment
```

也可以显式设置 `TEST_DATABASE_URL` 后运行 `npm run test:db`；入口要求数据库名为 `bazaar_test`，不会回退到 `DATABASE_URL`。测试密码只通过子进程环境传递，不输出带密码 URL。事务测试仅在本轮随机 schema 中建表/写入并清理；角色测试另外创建随机迁移/运行账号，验证后删除，需要专用测试管理员建角色权限。不会清理开发库或 public schema。

测试覆盖配置拒绝、Nest DTO 校验、真实 PostgreSQL 查询、认证、HTTP 资源越权、商品与订单状态转换、并发和幂等回放。DB-01—DB-11 与专用持久库重启验证已通过，详见 [V2 报告](../docs/backend-v2-report.md)。

I7 环境脚本只接受 `127.0.0.1:55433/bazaar_persistence` 的专用验证服务。它在该持久实例
中新建随机数据库、迁移/运行角色和私有账户输入文件，从空库部署全部迁移，验证授权、
ready、登录/退出及 runtime DDL 拒绝，重启容器后复核迁移和账户，最后删除本轮数据库、
角色和临时文件。不会读取或修改 `bazaar_dev`。

## 结构

- `src/app.ts`：应用组合、输入校验与生命周期。
- `src/database/`：Prisma client 与连接池，后续向用例层传递同一事务 client。
- `src/health/`：存活与数据库就绪检查。
- `prisma/`：schema 与追加迁移 SQL；手写 CHECK、条件索引和触发器随迁移管理，不改写已执行迁移。
- `src/orders/`：订单 HTTP、私有读取、命令、幂等和状态转换。
- `src/listings/`：商品锁和编辑/下架命令。
- `src/accounts/` 与 `src/auth/`：账户有效性、凭据、Session、Origin 和 CSRF 边界。
- `src/common/`：金额解析、错误映射等共享契约。
- `tests/`：编译产物测试；数据库入口独立。

依赖采用精确版本并由 package-lock.json 固定传递依赖。Prisma client 由构建生成，不提交生成文件。ESM 使用 NodeNext 与显式 `.js` 导入；TypeScript 先采用 5.9.3，避免在首次兼容验证中引入 TypeScript 7 的额外迁移变量。

## V2 持久化验证

先在仓库根目录启动独立服务：

```bash
sudo docker compose -f infra/compose.validation.yaml up -d --wait postgres-validation
```

然后在 backend/ 构建并运行：

```bash
npm run build
node scripts/with-persistence-db.mjs
```

此脚本使用 55433 端口的 bazaar_persistence 和独立命名卷，会重启 postgres-validation 容器，验证带数据升级与 API 进程重启后的历史/约束。它与 55432 的临时事务库独立。DB-10 测试结束清理本轮 schema，I7 环境测试清理本轮独立数据库和角色；在仓库根目录执行 `sudo docker compose -f infra/compose.validation.yaml stop postgres-validation` 停止验证服务并保留卷，无需常驻。

I8-1 备份恢复脚本同样只接受该专用服务。它以随机源库和恢复库验证宿主机
`pg_dump`/`pg_restore`，结束删除本轮数据库、角色和 0600 archive；详细步骤与生产边界见
[备份恢复验证](../docs/database-backup-recovery.md)。

实验金额 numeric(38,18)、TEST 币种、虚拟账户与地址只用于验证；产品币种/USD 参考价见[计价契约](../docs/backend-pricing-contract.md)。幂等及跨表状态规则见 C1 契约。

## 预置账户与认证

迁移后用迁移账号执行账户命令。输入文件放在已忽略的 backend/.tmp/，权限 0600，内容为 `[{"loginName":"...","displayName":"...","password":"..."}]`；密码 15—128 字符，不提供公共默认密码。显式设置 `SEED_ACCOUNTS_FILE` 后运行 `node scripts/provision-accounts.mjs`，整批插入失败则回滚，不覆盖已有账号。

密码重置输入为 `{"loginName":"...","password":"..."}`，执行同脚本加 `--reset-password`，会同时撤销该账户现有会话。脚本要求显式 DATABASE_URL 和私有文件，密码不放命令行或日志。

认证路由为 POST /api/auth/login、POST /api/auth/session、POST /api/auth/logout。前端 Origin 必须等于 APP_ORIGIN（默认 http://localhost:3000）；登录后写请求另外携带 session Cookie 与 X-CSRF-Token；退出 body 为 `{}`。HTTPS origin 自动启用 Secure Cookie，HTTP 只允许 loopback。本阶段不开放注册。完整请求/响应见 [OpenAPI](../docs/openapi/alpha.json)。
