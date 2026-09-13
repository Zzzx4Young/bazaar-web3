# Bazaar Web3 文档索引

更新：2026-09-13。内部 Alpha 的认证、商品、订单、交付、退款恢复和前端联调已经完成；未认证页面保留明确标注的 Demo 内容。I5 与 I6 验收状态见阶段记录。

## 当前文档与职责

| 文档 | 唯一职责 |
|---|---|
| [业务规格](server-alpha-spec.md) | Alpha 范围、状态、权限、数据约定与验收 |
| [后端架构设计](backend-architecture.md) | 模块职责、事务、存储、API/Worker 与 Web3 扩展边界；实现细节待评审 |
| [逻辑数据与事务](backend-data-design.md) | 正式模型的逻辑草案；实验实现与验收见 V2 报告 |
| [ORM 比较](orm-evaluation.md) | 已选 Prisma；保留与 TypeORM 的取舍及验证门槛 |
| [版本与数据库验证计划](backend-validation-plan.md) | 版本候选、环境缺口、事务与迁移实验步骤及验收门槛 |
| [容器化基础设施](../infra/README.md) | Compose / Kubernetes 可行性、编排文件、启动与数据保护 |
| [后端运行与验证报告](backend-validation-report.md) | 实际锁定版本与 V1 验证证据 |
| [V2 数据库验证报告](backend-v2-report.md) | 实验 schema、迁移、DB-01—DB-11 与持久化结果、C1—C3 边界 |
| [C1 核心契约](backend-core-contract.md) | schema 基线、事务、幂等、错误边界、数据库角色与迁移流程 |
| [后端阶段记录](backend-stage-report.md) | 当前阶段的实际变更、命令、验收与未验证边界 |
| [执行计划](execution-plan.md) | 依赖顺序、待交付物、工程加固和完成条件 |
| [I7 受控内测计划](internal-alpha-testing-plan.md) | 当前阶段的基线、诊断、环境、人工场景、缺陷闭环与退出条件 |
| [请求关联与安全日志契约](backend-observability-contract.md) | I7 请求 ID、日志字段、脱敏和失败边界 |
| [PostgreSQL 本地操作与只读 MCP](database-operations.md) | I8 宿主机 psql、观察角色、DBHub 和安全边界 |
| [内测问题模板](internal-testing-issue-template.md) | 不记录凭据或私有业务值的问题复现与回归字段 |
| [I7 内测执行记录](internal-testing-report.md) | 工程演练证据、人工场景状态、问题与阶段出口 |
| [前端功能基线](frontend-prototype-roadmap.md) | 已实现页面能力与演示限制 |
| [前端技术与启动](frontend-stack-recommendation.md) | 实际技术栈、启动及检查方式 |
| [演示数据契约](mock-data-spec.md) | Mock 和浏览器存储，不作为服务端模型 |
| [Alpha 决策](adr/0002-server-alpha.md) | Q1—Q4 决策摘要与原因 |
| [后端架构决策](adr/0003-backend-architecture.md) | 已确认独立模块化单体、TypeScript＋NestJS/Fastify＋PostgreSQL；ORM 已选 Prisma，具体版本待核对 |
| [前端先行决策](adr/0001-frontend-prototype-first.md) | 历史原因，阶段限制已被 ADR-0002 取代 |
| [复核登记](review-corrections.md) | 历史问题处置与剩余风险，非业务规格或工单 |
| [变更记录](CHANGELOG.md) | 已发生变化和验收摘要 |
| [GitHub MCP 配置与验证](github-mcp-setup.md) | WSL 环境变量、MCP 配置及验证边界 |

## 维护规则

- 一份文件负责一个层级：业务写规格、顺序写计划、原因写 ADR、已发生变化写日志。其他文档链接引用，不复制整套规则。
- 已确认不等于已实现。当前能力以源码和实际测试为准，历史测试通过不代表本轮验证。
- 技术接口、数据库细节和工单下一阶段编制，不编造选型或工期；新增产品范围仍先确认。
- [archive](archive/README.md) 仅供追溯，旧工单、估时和研究不能直接当作当前规范。
