# 容器化基础设施

更新：2026-09-10。供本地开发、数据库实验和已有 Kubernetes 集群内测使用。独立后端 V1 骨架见 [backend/README.md](../backend/README.md)，前端仍按 frontend/package.json 启动；本目录只编排 PostgreSQL，尚无 API 镜像；实验迁移与启动见 backend 文档。

## 可行性与选择

| 方案 | 适用场景 | 成本与边界 |
|---|---|---|
| Docker Compose（当前推荐） | 单机开发、真实 PostgreSQL 事务实验、CI 临时库 | 无需集群；命名卷持久化；主机故障仍会停机 |
| Kubernetes StatefulSet + PVC | 已有集群，需统一调度和配置的内测 | 需要 StorageClass、存储驱动与 Secret 管理；单副本无复制、自动故障切主或跨区容灾 |
| 托管 PostgreSQL / 数据库 Operator（后续评估） | 有明确可用性、备份恢复和运维要求的部署 | 需预算与运维方案；生产选择时另行评估，当前不安装 Operator |

Compose 能以健康检查表达依赖就绪；未来 API 可使用 depends_on.condition: service_healthy，但应用仍须处理运行中断线和有限重连。[Docker 官方说明](https://docs.docker.com/compose/how-tos/startup-order/)

StatefulSet 提供稳定身份与存储关联，默认删除工作负载不删除其 PVC。副本数不能直接增加为 3 来获得 PostgreSQL 复制；本模板固定一个数据库实例。[Kubernetes 官方说明](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)

| 组件 | 容器化安排 |
|---|---|
| PostgreSQL | 本次提供 Compose 开发库、临时测试库与 K8s 内测模板 |
| NestJS API / Prisma 迁移 | 后端可构建后加入 API 服务与一次性迁移任务；迁移成功后再启动新 API，避免每副本同时迁移 |
| Redis | 只有落地跨实例限流、缓存或队列后再加；库存事实仍在 PostgreSQL |
| 对象存储 | 图片上传范围确认后再选择兼容服务；数字交付继续使用外部链接 |
| Worker / 消息队列 | 当前没有异步任务需求，不增加空服务与资源消耗 |

## Docker Compose 启动

前置：Docker Engine 或 Docker Desktop，以及支持 up --wait 的 Docker Compose 插件；Linux 主机需可访问 Docker daemon。所有以下命令在仓库根目录运行。

```bash
bash infra/scripts/init-secrets.sh
docker compose -f infra/compose.yaml config --quiet
docker compose -f infra/compose.yaml up -d --wait postgres
docker compose -f infra/compose.yaml ps
```

密码脚本依赖 Bash 和 OpenSSL，生成两个独立随机密码，文件权限由 umask 077 限制；再次运行保留已有密码。密码位于已忽略的 infra/.secrets/，通过文件挂载传入，不写在 YAML 中。Compose 文件 secrets 是本地文件挂载，并非加密密码保管库。[Docker secrets 文档](https://docs.docker.com/reference/compose-file/secrets/)

| 用途 | 主机地址 | 数据库 / 初始化管理用户 | 存储 |
|---|---|---|---|
| 开发 | 127.0.0.1:5432 | bazaar_dev / bazaar_admin | postgres-data 命名卷 |
| 实验 | 127.0.0.1:55432 | bazaar_test / bazaar_test_admin | 1 GiB tmpfs，容器停止即丢弃 |

端口仅绑定回环地址。可在命令前设置 POSTGRES_PORT 或 POSTGRES_TEST_PORT 覆盖宿主机端口，例如 POSTGRES_PORT=15432 docker compose -f infra/compose.yaml up -d --wait postgres。Compose 网络内开发库地址是 postgres:5432，测试库是 postgres-test:5432；两者网络、数据和密码独立。

未来后端本地连接格式为 postgresql://bazaar_admin:<密码>@127.0.0.1:5432/bazaar_dev；实验入口使用独立 TEST_DATABASE_URL 和测试用户/端口/库名，不能回退到开发 URL。初始化用户具有超级用户权限，仅用于此开发环境和建库；正式 API 接入前拆分迁移角色和最小权限运行角色。

启动专用实验库（不启动开发库）：

```bash
docker compose -f infra/compose.yaml --profile test up -d --wait postgres-test
# 运行未来的数据库集成测试后，只停止实验服务。
docker compose -f infra/compose.yaml --profile test stop postgres-test
```

测试库保留默认事务持久性设置，不关闭 fsync；tmpfs 仅用于小规模事务实验，不代表磁盘性能或重启持久化。验证 DB-10 时使用开发命名卷或另建独立持久测试项目，不能用此临时库证明恢复能力。

检查版本和密码认证（容器内 TCP）：

```bash
docker compose -f infra/compose.yaml exec postgres sh -ec 'PGPASSWORD="$(cat "$POSTGRES_PASSWORD_FILE")" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SELECT version(), current_database();"'
```

健康检查仅判断数据库是否接受连接，不代表密码正确、迁移已应用或业务可用；上述 SQL 是独立的连接检查。

停止开发环境：

```bash
docker compose -f infra/compose.yaml down
```

命名卷保留；不要在需要保留数据时添加 -v。实验服务若仍运行，先按上面的 stop 命令停止它。

## Kubernetes 启动

前置：可访问的集群、kubectl、可动态提供 ReadWriteOnce 卷的默认 StorageClass。无默认类时，先在 statefulset.yaml 的 volumeClaimTemplates 中设置 storageClassName；不能将 Pending PVC 当作数据库启动故障。文件中的资源配额是内测起点，需按测试结果调整。

```bash
bash infra/scripts/init-secrets.sh
kubectl apply -f infra/k8s/postgres/namespace.yaml
kubectl -n bazaar-dev create secret generic postgres-credentials --from-file=password=infra/.secrets/postgres_password
kubectl apply --dry-run=server -k infra/k8s/postgres
kubectl apply -k infra/k8s/postgres
kubectl -n bazaar-dev rollout status statefulset/postgres --timeout=300s
kubectl -n bazaar-dev get pods,pvc,svc
```

Secret 创建命令只运行一次；再次部署时保留已有 Secret。Secret 不进入 Kustomize 输出或 Git；Kubernetes Secret 默认不等于 etcd 静态加密，需要集群侧加密与 RBAC 配置。[官方 Secret 说明](https://kubernetes.io/docs/concepts/configuration/secret/)

数据库使用非 root 进程，PVC 依赖存储驱动支持 fsGroup 权限；NFS root-squash 或固定权限卷需要预先匹配 UID/GID。模板使用 readiness/startup 探针，进程退出由 kubelet 重启；没有激进的 liveness 探针，避免繁忙数据库被循环重启。

集群内地址为 postgres.bazaar-dev.svc.cluster.local:5432（采用默认 cluster.local 域）；不创建 LoadBalancer 或 NodePort。宿主机调试可另开终端：

```bash
kubectl -n bazaar-dev port-forward --address 127.0.0.1 service/postgres 15432:5432
```

ClusterIP 不限制其他 Pod 访问；此模板面向受信内测集群。共享集群在接入 API 时按真实调用方标签和 CNI 能力补 NetworkPolicy，数据库连接加密也在部署契约中配置。

停止数据库并保留 PVC、Secret 和命名空间：

```bash
kubectl -n bazaar-dev scale statefulset/postgres --replicas=0
```

重新 apply -k 恢复一个副本。不要用删除命名空间来暂停服务：它会删除 PVC 等资源，底层卷是否被删除由回收策略决定。

## 版本、密码变更与数据保护

本次根据官方镜像标签列表选择 postgres:17.11-bookworm，两种编排一致；2026-09-10 已拉取并完成测试库启动与认证查询。补丁标签仍可被重新构建，部署验收后记录并固定实际 digest。17 系列挂载 /var/lib/postgresql/data；升级主版本需要单独迁移方案，不可直接修改镜像标签后复用旧数据目录。[PostgreSQL 官方镜像说明](https://hub.docker.com/_/postgres)

POSTGRES_USER、POSTGRES_DB 与密码文件只在空数据目录初始化时生效。修改密码文件或 K8s Secret 不会更新已有数据库密码；轮换必须同步执行数据库角色密码变更和应用凭据更新。

命名卷和 PVC 不是备份。内测可先手动导出逻辑备份到已忽略目录，再复制到受控异机存储；备份包含私有业务数据。以下命令只导出，不清库：

```bash
mkdir -p infra/backups
(umask 077; set -o noclobber; docker compose -f infra/compose.yaml exec -T postgres pg_dump -U bazaar_admin -d bazaar_dev -Fc > "infra/backups/bazaar-dev-$(date -u +%Y%m%dT%H%M%SZ).dump")
```

失败时可能留下不完整文件；应检查退出码，并在独立空库使用 pg_restore --exit-on-error 演练恢复、验证样例数量与约束，之后才能声明备份有效。生产环境还需确定备份周期、保留期、恢复目标和 WAL/PITR 方案。

## 本轮验证记录

2026-09-10：YAML 解析、Compose 服务与 Secret/卷引用、K8s selector/挂载引用静态检查、Bash 语法、密码初始化与重复运行保留验证、文档链接及 git diff --check 通过。这是编排文件初建时的验证记录；当时未安装 Docker/kubectl。后续容器验证结果如下。

后续按[数据库验证计划](../docs/backend-validation-plan.md)执行事务实验。K8s 内测库不作为破坏性集成测试目标。

## 2026-09-11 会话交接：本机环境与已验证结果

以下为本会话 2026-09-10 安装和验证的结果，非持续健康监控；下次启动会话先重新检查服务。

- 系统：Ubuntu 22.04.5 LTS / amd64 / WSL2，宿主 PID 1 为 systemd。沙箱内进程视图可能不同。
- 已安装官方 Jammy stable 包：Docker Engine/CLI 29.8.0、Compose 插件 5.5.1、containerd 2.3.5、Buildx 0.37.0。Docker 与 containerd 已启用自动启动，验证时均 active。使用 sudo docker；没有安装独立 docker-compose 或 Kubernetes 工具。
- Compose config 检查通过；postgres:17.11-bookworm 拉取成功，返回 digest 为 sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0。编排仍使用版本标签，尚未改为 digest 固定。
- postgres-test 已启动并通过健康检查；容器内 TCP 密码认证与 SELECT current_database(), current_user, version() 成功，返回 bazaar_test / bazaar_test_admin / PostgreSQL 17.11。地址为 127.0.0.1:55432。
- 未运行开发持久库、重启恢复、备份恢复、DB-01—DB-11 业务事务实验或 K8s 部署。测试库仍是 tmpfs，停止容器后数据丢失；WSL 关闭后下次需重新启动。

本机配置（不在仓库内，新机器不会随 git clone 获得）：

- /etc/local-proxy.env：统一大小写 HTTP/HTTPS/ALL_PROXY 与 NO_PROXY；代理为 http://127.0.0.1:10809，依赖 Windows 本机代理可用。
- ~/.bashrc 与 ~/.profile 加载上述文件；Docker 的 /etc/systemd/system/docker.service.d/http-proxy.conf 通过 EnvironmentFile 加载同一文件。旧终端可执行 source ~/.profile。
- /etc/docker/daemon.json 配置 registry-mirrors 为 https://docker.m.daocloud.io；该服务由 DaoCloud 维护，支持的配置见[官方项目](https://github.com/DaoCloud/public-image-mirror)。已验证端点可达，配置后镜像拉取成功。
- Docker apt 源位于 /etc/apt/sources.list.d/docker.sources。曾遇 IPv6 TLS 失败，安装使用临时 Acquire::ForceIPv4=true；未全局禁用 IPv6。
- 本机 curl 7.81 不支持 NO_PROXY 的 CIDR 匹配；localhost 等精确地址可用。Docker Hub 端点验证返回预期 401，Docker 下载站曾间歇 TLS 超时，不代表网络始终稳定。
- 原 shell 配置备份位于 ~/.config/proxy-backups/20260910T142616Z/。密码留在 infra/.secrets/，不能将密码原文或带密码 URL 写入交接记录。

下次继续（仓库根目录）：

```bash
sudo docker info
sudo docker compose -f infra/compose.yaml --profile test ps
sudo docker compose -f infra/compose.yaml --profile test up -d --wait postgres-test
sudo docker compose -f infra/compose.yaml --profile test exec postgres-test psql -U bazaar_test_admin -d bazaar_test
```

进入 psql 后用 \q 退出。业务实施顺序见[执行计划](../docs/execution-plan.md)，不要将数据库能连接视为后端已实现。

## 2026-09-11 V2 专用持久测试库

新增 [compose.validation.yaml](compose.validation.yaml)，独立项目 bazaar-validation、服务 postgres-validation、数据库 bazaar_persistence、用户 bazaar_validation_admin、宿主回环端口 55433 和命名卷 validation-data。复用本机已忽略的测试密码文件，与开发库隔离；实验管理角色不作为正式 API 运行角色。

```bash
sudo docker compose -f infra/compose.validation.yaml up -d --wait postgres-validation
# 在 backend/ 完成构建后运行，此入口会重启上述专用容器：
cd backend
node scripts/with-persistence-db.mjs
```

DB-10 已验证空库迁移、历史数据升级、容器/API 进程重启及手写约束保留，见 [V2 报告](../docs/backend-v2-report.md)。每轮随机实验 schema 已清理，容器和命名卷保留；可用 `sudo docker compose -f infra/compose.validation.yaml stop postgres-validation` 停止服务。未执行备份恢复、HA 或 Kubernetes 验证。
