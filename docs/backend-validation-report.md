# 后端运行与验证报告

日期：2026-09-11。范围：V1 依赖兼容性与最小运行骨架；V2 业务 schema、迁移与 DB-01—DB-11 尚未验收。对应[验证计划](backend-validation-plan.md)。

## 实现与版本

独立 `backend/` 包采用 NestJS/Fastify、Prisma PostgreSQL adapter、TypeScript NodeNext ESM。前端依赖和接口未改。应用只提供 `/api/health/live` 与 `/api/health/ready`；后者实际查询 PostgreSQL。配置校验、输入 ValidationPipe、受限连接池与关闭钩子已实现，无自动迁移或 seed。

| 组件 | 本轮版本 / 依据 |
|---|---|
| Node / npm | 实际运行 22.23.1 / 10.9.8 |
| Nest common / core / platform-fastify | 12.0.1，npm 包元数据与 peerDependencies 已核对 |
| Fastify | 5.12.1，由 Nest adapter 依赖并由 lockfile 固定 |
| Prisma CLI / Client / adapter-pg | 7.10.0；engines 为 `^20.19 || ^22.12 || >=24.0` |
| TypeScript | 5.9.3；此次不引入 registry 最新 TypeScript 7 的迁移变量 |
| ESLint / typescript-eslint | 10.10.0 / 8.70.0，安装无 peer 冲突 |
| PostgreSQL | Compose 镜像 17.11-bookworm，真实查询返回 17.11（Debian 17.11-1.pgdg12+2） |

2026-09-11 npm `prisma` 默认版本返回 8.0.0-rc.13，因此显式固定用户已选路线的 7.10.0。版本来源采用 npm 包元数据，运行方式对照 [Nest 迁移文档](https://docs.nestjs.com/migration-guide)、[Prisma v7 升级指南](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)和[生成器说明](https://docs.prisma.io/docs/cli/v7/generate)，兼容结论以本仓库验证为准。

## 依赖审计修复

原始 Prisma 7.10.0 工具链依赖 `@prisma/config → deepmerge-ts 7.1.5` 和 `mysql2 3.15.3`，npm audit 报告 4 项 high（含上游传递计数）。当前使用限定父包的 overrides：`@prisma/config → deepmerge-ts 8.0.2`、`prisma → mysql2 3.24.4`。更新后 npm install 审计为 0 vulnerabilities。

[DeepmergeTS 公告](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)将修复下限列为 8.0.0；这是跨主版本覆盖，须保留兼容验证。MySQL2 来源为 Prisma CLI，本应用运行连接仍仅使用 PostgreSQL。未使用 `npm audit fix --force` 降级 Prisma。后续 Prisma 升级时应复核并移除不再需要的 overrides。当前生成/配置与 PostgreSQL 验证不代表 Prisma Studio 或 MySQL 功能已验证。

## 验证记录

最终验收：以下命令全部退出码 0；配置/校验测试 2 项、数据库/进程集成测试 2 项通过。

| 命令（backend/） | 验证范围 |
|---|---|
| `npm ci --fetch-timeout=30000 --fetch-retries=1` | 从 lockfile 重装、包兼容与依赖审计 |
| `npm test` | Prisma 生成、ESM 构建；配置拒绝与 Nest DTO 校验 |
| `npm run typecheck` | 严格 TypeScript |
| `npm run lint` | ESLint |
| `node scripts/with-test-db.mjs` | 真实 PostgreSQL、HTTP 200/404/503、失败信息隐藏、关闭后重新连接；编译产物进程启动与 SIGTERM |

数据库测试使用显式 TEST_DATABASE_URL；Compose 便捷脚本从已忽略的测试密码文件读取，不输出 URL，也不回退到 DATABASE_URL。测试当前只读，不创建表或清库。初次沙箱运行网络测试失败；本机网络权限下两项集成测试通过。

## 验收边界与下一步

- V1 只验证运行基础；schema 目前仅有 generator 和 datasource，没有业务模型或迁移。
- 503 分支通过注入查询失败验证，不作为真实数据库停机/恢复或连接超时测试的结论。
- 应用实例重连和进程关闭不等于持久化验收。postgres-test 使用 tmpfs，DB-10 必须准备独立持久测试库。
- DB-01—DB-11 全部待实施；认证、Cookie/CSRF、资源越权、账户/商品/订单接口及前后端联调未实施。
- 下一工作包 V2：建立实验 schema → 审查迁移与手写约束 → 空库部署 → 先执行 DB-01/02/03/07 并发、幂等与回滚，再覆盖其余用例。通过后再定稿正式 schema 与接口。
