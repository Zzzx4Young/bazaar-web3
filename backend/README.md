# Bazaar 后端

独立 NestJS/Fastify + Prisma PostgreSQL 包，当前已完成 V1 运行骨架与 V2 实验模型/数据库验证。正式模型、认证与业务 API 按 [验证计划](../docs/backend-validation-plan.md)继续实施。

## 本地运行

Node 22.12+（本轮使用 22.23.1），npm 10.9.8。在本目录执行：

```bash
npm ci
npm run build
cp .env.example .env
# 将 .env 中 DATABASE_URL 的密码替换为本地开发库密码，并启动开发库。
npm start
```

默认监听 `127.0.0.1:3001`。`GET /api/health/live` 表示进程可响应；`GET /api/health/ready` 执行真实数据库查询，失败返回 503 且不返回驱动错误详情。启动要求数据库可连接；SIGINT/SIGTERM 触发 Nest 关闭钩子，释放 Prisma 连接池。每进程连接池上限 5，连接与语句超时均为 3 秒。

启动不会迁移、seed 或清理数据库。Prisma schema 和两次迁移用于 V2 实验；测试入口在随机隔离 schema 内部署和清理，应用不会自动创建业务表。不能把健康检查作为业务数据正确性的证明。

## 验证

```bash
npm run build
npm run typecheck
npm run lint
npm test
# 仓库 Compose postgres-test 已启动时，读取本地已忽略的测试密码文件：
node scripts/with-test-db.mjs
```

也可以显式设置 `TEST_DATABASE_URL` 后运行 `npm run test:db`；入口要求数据库名为 `bazaar_test`，不会回退到 `DATABASE_URL`。测试密码只通过子进程环境传递，不输出带密码 URL。事务测试只在本轮创建的随机 `v2_` schema 中建表/写入，结束后清理该 schema；不会清理开发库或 public schema。

测试覆盖配置拒绝、Nest DTO 校验、真实 PostgreSQL 查询、HTTP 200/404/503、失败信息隐藏、关闭后新应用重连。模拟 ping 失败用于验证 HTTP 错误映射，不代表真实数据库停机恢复已验收。DB-01—DB-11 与专用持久库重启验证已通过，详见 [V2 报告](../docs/backend-v2-report.md)。认证与 HTTP 资源越权验证待实施。

## 结构

- `src/app.ts`：应用组合、输入校验与生命周期。
- `src/database/`：Prisma client 与连接池，后续向用例层传递同一事务 client。
- `src/health/`：存活与数据库就绪检查。
- `prisma/`：实验 schema、两次已审查迁移 SQL；手写 CHECK、条件索引和触发器随迁移管理。
- `src/orders/`：订单命令、幂等和状态转换；暂未注册业务 HTTP 路由。
- `src/listings/`：商品锁和编辑/下架命令。
- `src/accounts/`：账户有效性边界；认证实现属于 C2。
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

此脚本使用 55433 端口的 bazaar_persistence 和独立命名卷，会重启 postgres-validation 容器，验证带数据升级与 API 进程重启后的历史/约束。它与 55432 的临时事务库独立。测试结束清理本轮 schema，保留容器和卷。

实验金额 numeric(38,18)、TEST 币种、虚拟账户与地址只用于验证；产品精度/币种、账户密码/会话和正式 API 属于后续契约。幂等及跨表状态规则的数据库/应用职责见 V2 报告。
