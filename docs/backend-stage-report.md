# 后端分阶段推进记录

## C1 收口（2026-09-12）

已固化 [核心契约](backend-core-contract.md)，保留三次已有迁移及 checksum；增加可重复的原子运行角色授权脚本、一次性角色初始化 SQL、真实 PostgreSQL 权限测试。运行角色不能执行 DDL、读取迁移表、修改不可变历史或切换为迁移角色。

验收完成：`node scripts/with-test-db.mjs` 24/24 通过；构建、typecheck、lint 与编译后的三个单元测试文件通过。`node scripts/with-persistence-db.mjs` 通过最终三次迁移的 DB-10，包括带数据升级、drift、持久容器和编译 API 进程重启，以及历史/手写约束保留。验收后已停止 postgres-validation，保留卷。前端未修改，未重跑浏览器测试。

首次角色测试正确触发 PostgreSQL 42501，但断言仅读取 Prisma meta.code，未兼容 adapter 包装；已改用与现有 schema review 相同的 originalCode 读取方式。没有放宽权限断言。

## 后端 CI（2026-09-12）

已增加独立 backend job：Node 22.23.1/npm 10.9.8、锁定依赖安装、生成/构建、类型、Lint、单元与真实 PostgreSQL 集成测试；凭据由 init-secrets.sh 临时生成，不在 workflow 中保存固定密码。失败只输出服务状态，always 步骤停止测试容器。保留前端 job，增加手动触发入口，workflow 权限限定 contents: read。

验证：YAML 成功解析为 verify/backend 两个 job，backend 12 步；对应构建、静态检查、单元与 24 项数据库命令本地通过。未提交/推送，未触发远端 Actions，不能称远端 CI 已通过。DB-10 专用持久化重启仍为本地显式验收，不以 CI 临时库替代。

## C2/C3 契约（2026-09-12）

已编制[认证/商品契约](backend-auth-listing-contract.md)、[订单契约](backend-order-contract.md)、[OpenAPI](openapi/alpha.json)与 [I1—I6 实现工单](backend-implementation-tasks.md)。OpenAPI 初版 21 路径/24 操作通过官方 3.0 JSON Schema、内部引用和 operationId 唯一性检查；增加币种端点后再次检查。

负责人随后要求主流多币种和统一换算比较，已采用 [USD 参考价契约](backend-pricing-contract.md)，取代同币种排序草案。原币种金额用于快照与模拟结算，汇率只供参考排序。首版 19 币种是工程白名单，不声称覆盖全球所有币种。

## I1 认证实现（2026-09-12）

已实现第四次追加迁移 AccountCredential/Session、Node scrypt、显式预置/密码重置命令、登录/会话/退出路由、会话轮换与撤销、Origin/CSRF、输入白名单、单进程登录限流和安全异常过滤器。运行角色只读凭据，可读写会话；真实受限账号登录/退出已验证。

`node scripts/with-test-db.mjs` 27/27 通过；build/typecheck/lint 和三个单元测试文件通过。`node scripts/with-persistence-db.mjs` 通过四次迁移，增加凭据/会话重启后完整相等断言。限流测试首轮将允许的第 5 次误当限流边界，已修正为第 6 次拒绝；没有更改限流策略。

尚未接前端、未创建实际开发测试账户、未运行浏览器用例或远端 CI。密码命令仅提供能力，未改现有账户。汇率与商品 HTTP 在 I2 实现。

## 下一任务

正在推进 I2 商品服务与 USD 参考价排序，随后按工单完成前端联调、订单接口与 E2E。Alpha 保持预置账户＋密码，不开放注册。
