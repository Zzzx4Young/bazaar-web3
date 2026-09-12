# 后端分阶段推进记录

## I4 收口（2026-09-12）

I4 后端工单完成。追加第六次迁移 `202609120004_delivery`，交付记录新增可空 carrier/accessCode；不修改已执行迁移。逐动作输入白名单已实现：request-refund 映射内部命令、confirmed/inHandAndResellable 必须为 true、数字商品拒绝收货地址、交付 URL 只允许无用户名密码的 HTTPS。新交付字段参与幂等摘要；不带新字段的历史命令摘要保持原结构。详情及六类响应按 OpenAPI 显式字段输出，测试使用 Ajv 校验响应结构（不以此声称完整格式验证）。现有表级运行授权覆盖新增列，无需扩大运行角色权限。

验收：build/typecheck/lint、三个单元测试文件、数据库集成 30/30；HTTP 测试使用独立随机受限角色，覆盖实物退款恢复、数字完成/退款、补交保持 issue、私有交付、同键改提取码冲突、竞争下单/付款取消/验收退款以及旧恢复重放不释放新库存。HTTP 竞争验证并发结果；真实阻塞时序仍由 DB-01—DB-08 屏障用例验证。DB-10 六次迁移通过，旧交付新增字段为 NULL，升级和容器/API 重启后旧、新交付字段保持一致。测试结束清理随机 schema/角色；开发库未迁移、未写测试数据。本轮没有浏览器或远端 CI 验收。

下一阶段见 [I5 顺序与出口](backend-implementation-tasks.md#i5-推进顺序)。I4 完成不代表此前 I3 的编辑/下架 UI 等缺口已解决；I5 首项先复核并收口这些联调前置条件。

## I4 HTTP 首轮回归（2026-09-12）

新增 `backend/tests/orders-http.integration.mjs`，通过真实 HTTP 注入和专用 bazaar_test 随机 schema 验证创建/付款同键回放、同键内容冲突、参与方详情、六类私有读取的匿名/外部账户拒绝、地址不进入摘要、合法与非法分页和角色过滤。测试结束清理本轮 schema，不写开发库。

修复查询字符串页码被数字校验器拒绝、创建默认 201 与契约 200 不符、列表摘要金额结构不符、动作入口外部账户未统一 404。数据库 client 恢复为命令层私有成员。CSRF 守卫移除 URL 子串豁免，仅允许路由元数据豁免；新增付款查询参数伪装 auth/session 仍拒绝且无结算写入的断言。两处旧认证测试补正确 Origin，以实际触达会话校验。

本轮 build/typecheck/lint、三个单元测试文件、真实数据库集成 30/30 通过。I4 尚未完整验收：结构化交付 carrier/accessCode 迁移、逐动作 DTO（含 request-refund 路径与 confirmed）、详情及子资源响应与 OpenAPI 全字段对齐、HTTP 并发与受限运行账号全流程仍待补齐。当前测试的交付读取为空集合，不代表交付内容与隐私已完整验收；未运行本轮 DB-10 或浏览器测试。

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

## I2 商品服务（2026-09-12）

已实现商品/币种 HTTP 路由、显式公开/私有 DTO、实物库存原子创建、卖家编辑/下架、版本竞争、19 个币种精度校验，以及 Coinbase USD 汇率快照与跨币种排序。汇率读取在事务外缓存，5 分钟过期；排序分页固定 quote，失败返回 FX_UNAVAILABLE，不阻塞 newest 列表或原币种下单。

验证：商品与汇率集成测试通过，覆盖两个账户共享数据、越权、未知字段、精度、数字/实物库存、下架、版本竞争、跨币种 USD 顺序、quote 过期、供应商异常和无副作用。此前 I1/C1/DB 回归合计 29/29 仍通过；构建、typecheck、lint、单元测试通过；最终四次迁移 DB-10 通过。未运行前端联调、浏览器 E2E、远端 CI，未创建开发预置账户。

## 下一任务

## I3 前端联调基础（2026-09-12）

已加入前端 backend API 客户端和商品转换层：探索页与商品详情优先读取后端公开接口，后端不可用时保留现有 Demo 回退；前端 Currency 类型扩展到首版主流币种，发布表单增加 USD/USDC/BTC 选项。随后完成登录/退出、Session 恢复、真实商品发布和双浏览器联调。凭据和 CSRF token 未写入浏览器存储。

验证：frontend typecheck、lint、production build、Vitest 23 个文件/197 个测试通过；Playwright I3-C 测试 1/1 通过。Alice 登录后通过 `POST /api/listings` 发布商品，Bob 使用独立 Session 登录，在探索页和刷新后都能看到该商品。测试使用可覆盖的 `PLAYWRIGHT_PORT` 和独立后端端口，避免复用旧开发进程。编辑/下架尚无对应前端界面，非所属卖家越权仍由后端 I2 集成测试覆盖；未运行远端 CI。

## 下一任务

I3 已完成出口，下一步进入 I4 订单 HTTP。Alpha 保持预置账户＋密码，不开放注册。
