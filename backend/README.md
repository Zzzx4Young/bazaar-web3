# Bazaar 后端

独立 NestJS/Fastify + Prisma PostgreSQL 包，当前交付 V1 运行骨架。业务模型、认证与业务 API 按 [验证计划](../docs/backend-validation-plan.md)继续实施。

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

启动不会迁移、seed 或清理数据库。Prisma schema 暂时仅定义生成器与数据源，业务迁移属于 V2；不能把健康检查作为业务数据正确性的证明。

## 验证

```bash
npm run build
npm run typecheck
npm run lint
npm test
# 仓库 Compose postgres-test 已启动时，读取本地已忽略的测试密码文件：
node scripts/with-test-db.mjs
```

也可以显式设置 `TEST_DATABASE_URL` 后运行 `npm run test:db`；入口要求数据库名为 `bazaar_test`，不会回退到 `DATABASE_URL`。测试密码只通过子进程环境传递，不输出带密码 URL。当前集成测试只读数据库；未来事务测试必须继续隔离开发库。

测试覆盖配置拒绝、Nest DTO 校验、真实 PostgreSQL 查询、HTTP 200/404/503、失败信息隐藏、关闭后新应用重连。模拟 ping 失败用于验证 HTTP 错误映射，不代表真实数据库停机恢复已验收。DB-01—DB-11、数据持久化、认证与 HTTP 越权验证尚待实施。

## 结构

- `src/app.ts`：应用组合、输入校验与生命周期。
- `src/database/`：Prisma client 与连接池，后续向用例层传递同一事务 client。
- `src/health/`：存活与数据库就绪检查。
- `prisma/`：schema；后续审查后的迁移 SQL 放入此目录。
- `tests/`：编译产物测试；数据库入口独立。

依赖采用精确版本并由 package-lock.json 固定传递依赖。Prisma client 由构建生成，不提交生成文件。ESM 使用 NodeNext 与显式 `.js` 导入；TypeScript 先采用 5.9.3，避免在首次兼容验证中引入 TypeScript 7 的额外迁移变量。
