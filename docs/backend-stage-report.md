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

## I2 商品服务（2026-09-12）

已实现商品/币种 HTTP 路由、显式公开/私有 DTO、实物库存原子创建、卖家编辑/下架、版本竞争、19 个币种精度校验，以及 Coinbase USD 汇率快照与跨币种排序。汇率读取在事务外缓存，5 分钟过期；排序分页固定 quote，失败返回 FX_UNAVAILABLE，不阻塞 newest 列表或原币种下单。

验证：商品与汇率集成测试通过，覆盖两个账户共享数据、越权、未知字段、精度、数字/实物库存、下架、版本竞争、跨币种 USD 顺序、quote 过期、供应商异常和无副作用。此前 I1/C1/DB 回归合计 29/29 仍通过；构建、typecheck、lint、单元测试通过；最终四次迁移 DB-10 通过。未运行前端联调、浏览器 E2E、远端 CI，未创建开发预置账户。

## 下一任务

## I3 前端联调基础（2026-09-12）

已加入前端 backend API 客户端和商品转换层：探索页与商品详情优先读取后端公开接口，后端不可用时保留现有 Demo 回退；前端 Currency 类型扩展到首版主流币种，发布表单增加 USD/USDC/BTC 选项。未把后端错误吞成成功状态，详情页仍支持本地 Demo 商品。

验证：frontend typecheck、lint、Vitest 23 个文件/197 个测试通过。尚未完成登录界面、发布真实 POST、前端会话状态、商品编辑 API 和 Playwright 双浏览器验收；因此 I3 尚未完成。

## 下一任务

继续 I3：实现前端登录/退出与内存会话，随后把发布表单接入真实 POST 和错误处理，再做双浏览器商品可见性/所有权验收；完成后进入 I4 订单 HTTP。Alpha 保持预置账户＋密码，不开放注册。
