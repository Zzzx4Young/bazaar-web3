# Bazaar 基础设施

此目录提供完整 Alpha Compose、单独的开发/测试 PostgreSQL、持久化验证库、
API 部署模板和单实例 Kubernetes PostgreSQL 模板。所有命令从仓库根目录执行；
若本机 Docker daemon 要求提权，在 `docker compose` 前加 `sudo`。

## 选择入口

| 入口 | 用途 | 数据位置 |
|---|---|---|
| `compose.alpha.yaml` | PostgreSQL、角色初始化、迁移、API、前端一体启动 | `bazaar-alpha` 项目的持久卷 |
| `compose.yaml` 的 `postgres` | 宿主机开发 API 与 V2 本机种子 | `bazaar-infra` 项目的持久卷，127.0.0.1:5432 |
| `compose.yaml` 的 `postgres-test` | 数据库集成与浏览器验收 | 独立 1 GiB tmpfs，127.0.0.1:55432；停止即清空 |
| `compose.validation.yaml` | 迁移、重启及备份恢复演练 | `bazaar-validation` 项目的持久卷，127.0.0.1:55433 |
| `compose.ha-validation.yaml` | 主备同步复制与人工提升演练 | 脚本生成独立项目、主备持久卷和回环动态端口；结束后清理 |
| `compose.ha-auto.yaml` | 三 PostgreSQL、三 etcd、Patroni 和两个固定写入入口的自动切换验收 | 独立随机项目、六个持久卷、两个固定代理端口和其余回环动态端口；结束后清理 |

这些项目的卷彼此独立；同名 `bazaar_dev` 不表示共享数据。日常使用只启动所需入口。
`postgres-test` 的临时存储不能用于验证重启持久性。

## 完整 Alpha

```bash
bash infra/scripts/init-secrets.sh
node infra/scripts/bootstrap-garage.mjs
docker compose -f infra/compose.alpha.yaml up -d --build --wait
docker compose -f infra/compose.alpha.yaml ps
```

Garage 引导脚本会先启动独立的 hot/cold 容器，配置各自 bucket、访问密钥与 hot PUT CORS，
并将密钥写入已忽略的 `infra/.secrets/garage-app/`。完整启动顺序是 Garage 引导、
PostgreSQL → 角色 bootstrap → migrate → API/归档任务 → 前端。
打开 http://localhost:3000/zh-CN。
首次运行不会创建业务账户或商品。可通过 `POSTGRES_PORT`、`API_PORT`、
`FRONTEND_PORT` 改宿主端口；更改前端访问地址时同步设置准确的 `APP_ORIGIN`。

需要登录时，先按[后端账户格式](../backend/README.md#本机账户与-v2-数据)准备权限 0600 的
`backend/.tmp/alpha-accounts.json`，再将内容经标准输入送入一次性迁移镜像：

```bash
docker compose -f infra/compose.alpha.yaml run --rm --no-deps -T \
  -e SEED_ACCOUNTS_FILE=/tmp/alpha-accounts.json migrate \
  sh -ec 'umask 077; cat > "$SEED_ACCOUNTS_FILE"; export DATABASE_URL="$(cat /run/config/migration_database_url)"; exec node scripts/provision-accounts.mjs' \
  < backend/.tmp/alpha-accounts.json
```

输入文件仅在本机私有目录与本次临时容器中使用；命令不会把密码放在参数中。
宿主机 `npm run seed:v2` 只接受 loopback 开发库，不会填充此 Compose 数据卷。

```bash
docker compose -f infra/compose.alpha.yaml down
```

`down` 默认保留命名卷；数据与凭据卷仍属于该 Compose 项目。
不要在需要保留数据时附加 `-v`。

商品图片的隔离恢复演练先启动 `postgres-test`，再从 `backend/` 运行
`npm run test:media:restore`。脚本创建独立的 hot/cold Garage 源容器和恢复容器，
对测试 schema 执行 `pg_dump`/`pg_restore`，在停止源容器后备份两套 Garage 的
`meta` 与 `data` 卷，恢复到新卷并分别读取 hot 与 cold 订单图片。结束时清理
`bazaar-media-recovery` 测试容器、卷、临时归档和测试 schema；开发库与
`bazaar-alpha` 的 Garage 卷不参与演练。正式备份还必须安全保存 RPC 密钥、
S3 凭据和 PostgreSQL 凭据，并在独立故障域保管备份；此本机演练不证明跨主机高可用。

## 开发库与测试库

```bash
bash infra/scripts/init-secrets.sh
docker compose -f infra/compose.yaml up -d --wait postgres
docker compose -f infra/compose.yaml --profile test up -d --wait postgres-test
```

密码初始化脚本使用独立随机密码，保存在已忽略的 `infra/.secrets/`；
再次运行保留已有值。`postgres` 使用持久卷，`postgres-test` 停止后丢失数据。
数据库开放到宿主机回环地址；应用应使用受限运行角色，迁移与种子使用迁移角色。
角色配置、本机观察视图与宿主机 `psql` 见[后端 README](../backend/README.md)。

```bash
docker compose -f infra/compose.yaml --profile test stop postgres-test
docker compose -f infra/compose.yaml down
```

数据库健康检查只证明服务可连接；API 的 `POST /api/health/ready` 才检查应用连接。

## 持久化与恢复演练

```bash
docker compose -f infra/compose.validation.yaml up -d --wait postgres-validation
cd backend
npm run build
node scripts/with-persistence-db.mjs
npm run test:backup-restore
```

脚本只使用独立的 `bazaar_persistence`，创建临时源库和恢复库，检查迁移、
权限、业务数据及重启后的结果；临时对象在测试结束后清理。
回到仓库根目录后可运行
`docker compose -f infra/compose.validation.yaml stop postgres-validation` 保留验证卷。
此演练不等于生产备份调度或灾难恢复方案；生产仍需明确备份保留、异地副本、
恢复目标和 WAL/PITR 策略。

开发库需要手动导出时，可在根目录运行以下命令。归档包含私有业务数据；
检查命令退出状态，并在独立空库演练恢复后才将其视为有效备份。

```bash
mkdir -p infra/backups
(umask 077; set -o noclobber; docker compose -f infra/compose.yaml exec -T postgres \
  pg_dump -U bazaar_admin -d bazaar_dev -Fc > "infra/backups/bazaar-dev-$(date -u +%Y%m%dT%H%M%SZ).dump")
```

## 主备复制与切换演练

在仓库根目录执行：

```bash
cd backend
npm run test:postgres-ha
```

脚本通过 `sudo -n docker compose` 操作独立的 PostgreSQL 17.11 主备项目，需要本机
Docker 权限。它生成私有凭据、动态回环端口和两个持久卷，验证同步复制、旧主库停止、
备库提升及真实订单、库存和会话保留；结束时清理本轮环境，开发库不参与。
报告保存到已忽略的 `backend/.tmp/postgres-ha-report.json`。
不要直接用该 Compose 文件替换开发或生产数据库：它没有自动选主、稳定写入入口或
旧主库重新加入机制。实测范围与后续验收见[容量与可用性验收](../backend/CAPACITY.md)。
已确认的零丢失、60 秒恢复目标及自动切换实施矩阵见[数据库自动切换验收](HA.md)。
自动切换脚本入口为 `npm run test:postgres-ha:auto`，首次需要按该文档构建 Patroni
验证镜像。它已通过本机主库故障、旧主库重新加入、无备库保护和仲裁失去多数后的
降级及恢复测试，并在独立仲裁网络隔离中直接验证旧主库在租约到期前转为只读。
同步主备混合负载及 API 故障下的五分钟负载已通过，每 API 连接池为 10；
入口为 `npm run test:capacity:ha`，完整参数、默认池 5 的失败及优化证据见[容量验收](../backend/CAPACITY.md)。
持续 500 请求/秒的本机主库 SIGKILL 已通过当前实现两分钟实测：29.287 秒恢复写入，
6000 笔故障模型订单核对无丢失；故障响应与恢复回放分开统计，退出及清理回执已保存。
全部备库失联带负载在当前实现上已通过：60000 个请求零丢弃，23.611 秒恢复写入，
确认停止窗口内新请求零成功确认，6000 笔订单及关联数据核对通过；故障响应和恢复
回放分别计数。命令及子进程退出码零，专用清理回执已保存；详见容量文档。
更广的网络分区、进程冻结、生产 fencing、入口冗余和长期稳定性仍待验收。

## Kubernetes 单实例内测模板

已有可用集群、`kubectl` 和默认 StorageClass 时，可部署数据库模板：

```bash
bash infra/scripts/init-secrets.sh
kubectl apply -f infra/k8s/postgres/namespace.yaml
kubectl -n bazaar-dev create secret generic postgres-credentials \
  --from-file=password=infra/.secrets/postgres_password
kubectl apply --dry-run=server -k infra/k8s/postgres
kubectl apply -k infra/k8s/postgres
kubectl -n bazaar-dev rollout status statefulset/postgres --timeout=300s
```

Secret 创建命令只执行一次，重新部署时保留现有 Secret。
暂停服务可运行 `kubectl -n bazaar-dev scale statefulset/postgres --replicas=0`；
PVC 和 Secret 仍保留。该模板只包含单实例数据库，没有自动故障切换。

## 部署模板

`compose.api.yaml` 编排一次性迁移任务、受限 API 和订单图片归档任务，不自带数据库或对象存储。
部署前需要准备独立的 hot/cold Garage S3 端点和 bucket（`bazaar-hot`、`bazaar-cold`）、
四个凭据文件，并设置 `GARAGE_HOT_ENDPOINT`、浏览器可访问的
`GARAGE_HOT_PUBLIC_ENDPOINT`、`GARAGE_COLD_ENDPOINT` 与对应的四个 `*_FILE` 路径。
hot 端点需要允许前端来源执行带 `Content-Type` 的签名 PUT 请求；前端还需能访问 API 的图片读取路由。
模板使用独立的迁移/运行连接文件、不可变镜像引用和迁移成功依赖；
镜像构建、检查与回滚步骤位于本地 `docs/api-deployment-runbook.md`。
`k8s/postgres/` 是已有集群的单实例数据库模板，需要预置 StorageClass、Secret 和访问策略；
单副本没有复制或自动故障切换，仓库未验收远端 Kubernetes 部署。
