# Bazaar 后端

独立 NestJS/Fastify + Prisma/PostgreSQL 服务。负责认证、商品、购物车订单、
模拟结算、交付、争议与退款、管理员裁决、卖家评价及审计。
接口字段以 [OpenAPI](openapi/alpha.json) 为准；完整项目启动见[根 README](../README.md)。

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
启动不会自动迁移、生成商品或清理数据库。部署容器可用 `DATABASE_URL_FILE`
挂载连接信息，不能同时设置 `DATABASE_URL`；镜像与回滚见本地
`docs/api-deployment-runbook.md`。

`POST /api/health/live` 检查进程；`POST /api/health/ready` 查询数据库。
前端 Origin 必须等于 `APP_ORIGIN`（默认 `http://localhost:3000`），写请求携带会话 Cookie
和 CSRF token。每个响应带 `X-Request-Id`；错误和脱敏日志使用同一 ID。
汇率快照有效期为 1 小时，过期且供应商不可用时排序返回 `FX_UNAVAILABLE`。
服务启动后及此后每分钟处理一次超过 30 分钟的待付款订单，释放受限库存并记录系统事件。

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
需要先从仓库根目录启动 `postgres-test`；不会回退到开发库：

```bash
sudo docker compose -f infra/compose.yaml --profile test up -d --wait postgres-test
```

前端的 `npm run test:e2e:alpha`、`npm run test:e2e:v2` 会自行启动和停止该测试容器。
持久化升级和备份恢复另用 `postgres-validation`，见[基础设施 README](../infra/README.md)。
后端代码位于 `src/`，追加迁移位于 `prisma/migrations/`，数据库与 HTTP 测试位于 `tests/`；
迁移脚本、种子和观察入口位于 `scripts/`。已执行迁移不改写。
