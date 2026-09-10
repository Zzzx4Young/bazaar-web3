# ORM 选择评估

更新：2026-09-09。状态：用户已选择 Prisma，保留比较依据；未安装依赖、未运行基准或数据库实验。依据：[数据与事务设计](backend-data-design.md)。

## 需求与候选

两者都可用于本项目，不以框架跑分或“更现代”代替判断。必须支持跨模块共享事务、参数化 SQL、精确金额、迁移审查和真实数据库测试。

| 维度 | Prisma | TypeORM |
|---|---|---|
| 模型组织 | Schema 与生成 Client 路线；有利于统一检查数据定义 | TypeScript Entity 与 Repository 路线；贴近按模块组织实体 |
| 跨模块事务 | 交互式事务中传递事务 Client，避免回到全局 Client | 传递事务 EntityManager / QueryRunner，避免调用全局 Repository |
| 单件库存 | 可用条件更新或事务内参数化 SQL；显式锁方案按版本核对 | 可通过查询构建与事务 SQL实现；所有相关写入须同一事务连接 |
| 数据库约束 | 迁移 SQL需审查；不能只看模型声明是否生成成功 | 迁移同样要审查，持久环境关闭自动 synchronize |
| 主要取舍 | 集中 schema 和类型生成较直接；数据库专用能力需要核对版本和迁移能力 | 模块内实体与显式事务控制自然；需防止实体直接成为 API DTO、事务 Repository 使用错误 |

## 已确认选择与理由

2026-09-09 用户明确回复“选择Prisma”。采用 Prisma：团队已采用 TypeScript，希望在 schema、类型和迁移上建立统一入口；核心业务依然以 PostgreSQL 约束和事务设计为准，不限制为纯 ORM 操作。若更看重模块内实体组织、显式 Repository / QueryRunner 工作方式，则选择 TypeORM 同样合理。

上述选择已确认，但理由属于工程判断，不是已验证的性能优势。Prisma 官方文档存在不同主版本路线，本次引用明确版本的能力说明，不能据此默认安装最新版或锁定旧版；下一步核实受支持版本、Node/Nest/Fastify 兼容性、事务与迁移能力，再实施依赖和验证任务。后续版本依据、环境检查与实验验收见[验证计划](backend-validation-plan.md)。

## 选择后的验证门槛

1. 用临时 PostgreSQL 测试库验证数据文档的 T1/T2/T4，至少覆盖并发竞争、回滚和重复请求；不能用 SQLite 或 mock 代替事务验证。
2. 审查生成的外键、唯一/条件唯一约束和索引 SQL；确认 schema 变更不会丢失手写数据库对象。
3. 验证事务上下文跨模块传播、错误映射和有限重试，以及 decimal 序列化。
4. 从空库迁移、已有数据升级并验证保留；分别设计应用回滚与数据库修复，不承诺所有 DDL 都能无损回滚。
5. 验证通过再锁版本、编制正式 schema 和接口；如候选不满足要求，提供具体失败证据重新确认。

## 官方参考（2026-09-09 核对）

- [Prisma v7 事务](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions)：交互式事务、隔离级别和写冲突处理。
- [Prisma v6 迁移工作流](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production)：生成与编辑迁移流程；这是版本化参考，不是安装 v6 的建议。
- [TypeORM 事务](https://typeorm.io/docs/transactions/)：在事务回调中使用提供的 EntityManager。
- [TypeORM 迁移配置](https://typeorm.io/docs/migrations/setup/)：关闭自动同步、显式维护迁移。

本文件仅总结与项目相关的机制，不代表性能测试、全量安全审计或版本兼容性验收。
