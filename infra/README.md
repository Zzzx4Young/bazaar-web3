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

这些项目的卷彼此独立；同名 `bazaar_dev` 不表示共享数据。日常使用只启动所需入口。
`postgres-test` 的临时存储不能用于验证重启持久性。

## 完整 Alpha

```bash
bash infra/scripts/init-secrets.sh
docker compose -f infra/compose.alpha.yaml up -d --build --wait
docker compose -f infra/compose.alpha.yaml ps
```

打开 http://localhost:3000/zh-CN。启动顺序是 PostgreSQL → bootstrap → migrate → API → 前端。
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

`compose.api.yaml` 仅编排一次性迁移任务和受限 API，不自带数据库。
它使用独立的迁移/运行连接文件、不可变镜像引用和迁移成功依赖；
镜像构建、检查与回滚步骤位于本地 `docs/api-deployment-runbook.md`。
`k8s/postgres/` 是已有集群的单实例数据库模板，需要预置 StorageClass、Secret 和访问策略；
单副本没有复制或自动故障切换，仓库未验收远端 Kubernetes 部署。
