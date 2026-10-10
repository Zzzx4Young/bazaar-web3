# Bazaar Web3

面向实物二手商品和数字内容交易的内部 Alpha。前端为 Next.js 14，后端为
NestJS/Fastify + Prisma，业务数据保存在 PostgreSQL；浏览器通过前端同源代理访问 API。

I1–I8、内部 Alpha 和 V2 业务数据验收已完成。提交 `c8bd3ab` 的
[GitHub Actions](https://github.com/Zzzx4Young/bazaar-web3/actions/runs/35752730311)
通过了前后端检查、PostgreSQL 集成测试、部署镜像及 Alpha/V2 Chromium 流程。
V2 流程会生成 200 件商品、60 笔多状态订单，并保存桌面/手机截图、视频和 trace。
这属于受控内测验收，尚无公开部署或生产容量结论。

## 功能与边界

| 领域 | 当前能力 |
|---|---|
| 账户 | 预置账户登录、会话轮换与撤销、CSRF 保护；买家、卖家和管理员角色 |
| 商品 | 发布、编辑、下架、搜索、筛选、分页及多币种参考价排序 |
| 交易 | 单件购买和 2–5 件跨卖家购物车；模拟付款、订单过期与库存释放 |
| 履约 | 实物/数字交付、分段交付、验收、争议、卖家还价、管理员裁决与退款 |
| 评价 | 完成订单后由买家评价卖家；公开卖家评分 |
| 运维 | 追加迁移、受限数据库角色、只读观察视图、备份恢复演练和 CI 浏览器验收 |

收藏 ID 只保存在浏览器，并通过后端确认商品仍公开；购物车按账户保存在当前浏览器会话。
账户、商品、订单和评价均以 PostgreSQL 为准。付款与余额是模拟记录；
公开注册、图片托管、通知、聊天、钱包、链上结算和真实支付尚未实现。

## 本地启动

需要 Node.js >=22.12、npm 10.9.8、Docker Engine/Compose。在仓库根目录执行：

已有宿主机开发环境（`backend/.env`、`backend/.tmp/i7-migrate.env` 和两端依赖已准备好）时，
用一条命令复用持久开发库并启动前后端：

```bash
./start.sh
```

脚本会初始化缺失的本地数据库密码、启动 `compose.yaml` 的 `postgres`、构建后端、
部署迁移，再启动后端和前端并检查健康接口、探索页与商品搜索。
保持终端打开；按 Ctrl+C 停止应用进程，数据库仍保持运行。若 3000 或 3001 端口已有服务，
脚本不会替换它们。脚本不会重置数据库或自动生成商品。
Docker 需当前用户可访问，或已配置无交互的 `sudo docker`。
若宿主机提供 `HTTP_PROXY` 或 `HTTPS_PROXY`，脚本会让后端 Node 进程使用这些代理；
此能力需要 Node.js >=22.21。价格排序首次请求会刷新一小时有效的汇率快照。

需要独立的完整容器环境时，使用另一套数据库卷：

```bash
bash infra/scripts/init-secrets.sh
docker compose -f infra/compose.alpha.yaml up -d --build --wait
```

打开 http://localhost:3000/zh-CN 或 http://localhost:3000/en。
完整 Compose 首次启动会按 PostgreSQL → 角色初始化 → 迁移 → API → 前端运行；
不会自动创建业务账户或测试商品。完整 Compose 的账户预置见
[基础设施 README](infra/README.md#完整-alpha)；宿主机 V2 种子见[后端 README](backend/README.md#本机账户与-v2-数据)。
不同 Compose 项目使用各自的数据库卷，
现有 `infra/compose.yaml` 开发库数据不会自动出现在 `compose.alpha.yaml` 页面上。
停止服务可运行 `docker compose -f infra/compose.alpha.yaml down`，默认保留数据卷。

## 验证与目录

```bash
cd frontend
npm ci
npm run check:frontend
npm run test:e2e:v2
```

浏览器验收需要可用的 Docker、Chromium 和测试数据库，使用隔离数据并在结束后清理。
后端检查及数据库测试入口见 [后端 README](backend/README.md)。

- [前端](frontend/README.md)：页面、浏览器状态与前端命令。
- [后端](backend/README.md)：API、数据库角色、种子数据与测试。
- [基础设施](infra/README.md)：Compose、Kubernetes 模板、备份和停止方式。
- [接口契约](backend/openapi/alpha.json)：请求与响应字段。

`docs/` 是本地工作文档目录，已被 Git 忽略；其中的阶段记录不随本仓库提交发布。
