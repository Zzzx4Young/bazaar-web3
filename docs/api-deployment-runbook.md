# API 部署与回滚手册

更新：2026-09-14。I8-2 提供两个独立镜像 target 和受控 Compose 入口：`runtime` 只包含
编译产物及生产依赖，`migrate` 包含 Prisma CLI、迁移和授权脚本。应用启动不会隐式迁移、
seed 或清理数据库。

## 产物与边界

| 产物 | 职责 | 默认进程 |
|---|---|---|
| `backend/Dockerfile` 的 `runtime` target | 运行 NestJS/Fastify API | `node dist/main.js` |
| `backend/Dockerfile` 的 `migrate` target | 部署迁移并刷新 runtime 授权 | `node scripts/deploy-migrations.mjs` |
| `infra/compose.api.yaml` | 先迁移、再启动 API，挂载两个数据库 URL secret | Compose |

数据库不包含在该编排中。部署方提供 PostgreSQL 17 连接、预先创建的迁移/运行角色和专用
schema；角色约束见[核心契约](backend-core-contract.md#数据库角色)。入口不创建数据库或角色，
也不接收管理员连接。

## 构建与标记

从仓库根目录构建，并用提交 SHA 标记镜像和 OCI revision：

```bash
revision=$(git rev-parse HEAD)
docker build --target runtime --build-arg VCS_REF="$revision" -t "registry.example/bazaar-api:$revision" backend
docker build --target migrate --build-arg VCS_REF="$revision" -t "registry.example/bazaar-api-migrate:$revision" backend
```

发布后记录 registry 返回的 digest。部署变量使用 `image@sha256:...`，避免可变 tag 在回滚或
扩容时得到不同内容。镜像基于 Node 22.23.1 bookworm-slim 并安装 OpenSSL，进程用户为
`node`；runtime target 不包含 Prisma CLI。

## 配置与 Secret

创建权限 0700 的私有目录，并在其中创建两个容器用户可读的只读文件；每个文件只包含一行
完整、URL 编码后的 PostgreSQL URL。Compose 单机文件 secret 保留宿主机文件权限，因此应
结合目录权限限制其他宿主机用户，并在目标主机实测 UID/权限：

- migration URL：迁移角色，目标参数包含 `?schema=bazaar`；
- runtime URL：最小权限运行角色，指向同一数据库和 schema。

设置以下部署变量；不要把 URL、密码或展开后的 Compose 配置写入仓库和工单：

```bash
export BAZAAR_API_IMAGE='registry.example/bazaar-api@sha256:...'
export BAZAAR_MIGRATE_IMAGE='registry.example/bazaar-api-migrate@sha256:...'
export MIGRATION_DATABASE_URL_FILE='/absolute/private/migration_database_url'
export RUNTIME_DATABASE_URL_FILE='/absolute/private/runtime_database_url'
export DATABASE_RUNTIME_ROLE='bazaar_runtime'
export APP_ORIGIN='https://alpha.example'
export API_PORT='3001'
```

`APP_ORIGIN` 必须是精确 HTTPS origin；HTTP 仅允许 loopback。API 默认只发布到宿主机
`127.0.0.1`，由同机受信反向代理终止 TLS。Compose 对两个服务启用非 root、只读根文件系统、
`no-new-privileges` 和 capability 清空。

## 部署与检查

先解析配置，再拉取并启动。`api` 只会在一次性 `migrate` 成功退出后启动：

```bash
docker compose -f infra/compose.api.yaml config --quiet
docker compose -f infra/compose.api.yaml pull
docker compose -f infra/compose.api.yaml up -d --wait
docker compose -f infra/compose.api.yaml ps
```

`POST /api/health/live` 只证明进程响应；`POST /api/health/ready` 查询数据库。两者都必须携带
与 `APP_ORIGIN` 相同的 `Origin` 和 `Content-Type: application/json`。Compose 和镜像内置
readiness 探针。业务数据、迁移数量和权限仍需按发布检查表核对，不能只看 health。

价格排序首次需要从 Coinbase 获取汇率，随后在数据库中复用 1 小时快照；上述健康检查不验证
供应商连通性。部署网络应允许容器直连 Coinbase HTTPS，或显式提供容器可达的代理并仅对
`api` 进程启用 Node 的环境代理支持（当前镜像固定 Node 22.23.1）。不要将宿主机的
`127.0.0.1` 代理地址直接注入容器。发布检查应以有效 `Origin` 请求一次
`POST /api/listings/search` 的 `price_asc`，确认返回 200 和 `quote`；否则快照过期后该排序
返回 `FX_UNAVAILABLE`，即使 readiness 仍正常。生产环境不依赖本机演示数据的预置汇率。

部署后至少确认：migrate 退出码为 0、API healthy、`_prisma_migrations` 有 6 个已完成迁移、
runtime 能读写正式表且不能读取迁移表或执行 DDL、登录和一个只读业务请求成功。日志不得
出现 URL、密码、Cookie、CSRF、请求 body 或私有业务值。

## 回滚

迁移保持追加和向后兼容。发布前先确认旧 API 镜像能在新 schema 上运行；不能满足时应先
修复前向版本。应用回滚步骤：

1. 将 `BAZAAR_API_IMAGE` 改为上一已验收 digest，保留当前数据库和迁移记录。
2. 执行 `docker compose -f infra/compose.api.yaml up -d --no-deps --wait api`。
3. 复核 readiness、登录和关键只读请求，记录新旧 digest、时间和原因。

仓库不提供 down migration，也不得用 Prisma reset 回滚保留数据的环境。只有数据库损坏或
迁移数据错误且前向修复不可行时，才按[备份恢复记录](database-backup-recovery.md)在隔离环境
验证恢复点后执行数据库恢复；该操作会改变恢复点后的数据，需单独决策。

## 验收入口与未覆盖项

本地或 CI 启动一次性 `postgres-test` 并构建两个 `:ci` 镜像后，在 backend 目录运行：

```bash
npm run test:deployment
```

验收使用随机 schema 和角色，验证 6 个迁移、runtime 授权、DDL 拒绝、API readiness、非 root、
只读文件系统及 runtime 镜像不含 Prisma CLI，结束清理容器、schema 和角色。

I8-2 不包含镜像仓库发布、云主机/集群部署、TLS/域名、反向代理配置、Secret 管理平台、镜像
签名与 SBOM、漏洞准入、自动发布、扩缩容、容量指标、HA 或公开访问。这些能力需要明确目标
环境后另立验收。
