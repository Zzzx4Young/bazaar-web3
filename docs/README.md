# Bazaar Web3 文档索引

更新：2026-09-08。当前实现为前端 Demo；服务端 Alpha 业务基线已定，后端、数据库与认证尚未实现。

## 当前文档与职责

| 文档 | 唯一职责 |
|---|---|
| [业务规格](server-alpha-spec.md) | Alpha 范围、状态、权限、数据约定与验收 |
| [执行计划](execution-plan.md) | 依赖顺序、待交付物、工程加固和完成条件 |
| [前端功能基线](frontend-prototype-roadmap.md) | 已实现页面能力与演示限制 |
| [前端技术与启动](frontend-stack-recommendation.md) | 实际技术栈、启动及检查方式 |
| [演示数据契约](mock-data-spec.md) | Mock 和浏览器存储，不作为服务端模型 |
| [Alpha 决策](adr/0002-server-alpha.md) | Q1—Q4 决策摘要与原因 |
| [前端先行决策](adr/0001-frontend-prototype-first.md) | 历史原因，阶段限制已被 ADR-0002 取代 |
| [复核登记](review-corrections.md) | 历史问题处置与剩余风险，非业务规格或工单 |
| [变更记录](CHANGELOG.md) | 已发生变化和验收摘要 |

## 维护规则

- 一份文件负责一个层级：业务写规格、顺序写计划、原因写 ADR、已发生变化写日志。其他文档链接引用，不复制整套规则。
- 已确认不等于已实现。当前能力以源码和实际测试为准，历史测试通过不代表本轮验证。
- 技术接口、数据库细节和工单下一阶段编制，不编造选型或工期；新增产品范围仍先确认。
- [archive](archive/README.md) 仅供追溯，旧工单、估时和研究不能直接当作当前规范。
