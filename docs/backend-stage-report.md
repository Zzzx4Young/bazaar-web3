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
## I5 前置：同源请求与会话状态（2026-09-12）

浏览器 API 固定使用 `/api`，Next.js rewrite 转发到服务端环境变量 `BACKEND_ORIGIN`（默认 `http://127.0.0.1:3001`）。启动前端前设置该变量；后端 `APP_ORIGIN` 必须等于浏览器实际访问的完整 origin，包括端口。原 `NEXT_PUBLIC_API_BASE_URL` 不再控制浏览器请求地址。代理保留客户端 Origin，后端继续校验，不伪造可信来源。

会话恢复请求去重，旧恢复结果不能覆盖后续登录/退出结果。恢复网络失败显示服务不可用，区别于未登录。退出网络失败保留会话并显示可重试错误；成功退出或后端明确返回未认证后才清空会话。退出按钮有明确文案并禁用重复提交；认证文案进入中英文目录。

验证：前端 typecheck、lint、201 项单元测试、生产 build 通过。新增会话测试覆盖恢复/登录竞争、恢复去重、退出失败重试、过期退出、网络故障与未登录区分。生产构建有 next-intl 动态 import 的 Webpack 缓存分析提示，构建成功。

专用浏览器脚本：先从 backend 执行 `npm run build`，启动 `postgres-test`，再从 backend 执行 `node scripts/check-frontend-session.mjs`。脚本创建随机隔离 schema 和受限 runtime role，密码只在内存传给浏览器输入；启动真实后端与 Next.js，使用 Chromium 验证同源登录、刷新、退出断网/重试、退出撤销和错误 Origin。结束关闭自建服务、浏览器并删除本次 schema/role，不写开发库。默认前端端口 3838，可用 `SESSION_CHECK_PORT` 调整。脚本不保留浏览器 trace、截图或登录请求内容。

最终浏览器脚本已通过，额外验证后端服务重启后刷新仍登录，以及独立浏览器 context 不继承登录会话。断网采用浏览器 abort 注入，其余成功请求均经过真实代理、后端与数据库。首次失败来自提示定位器匹配多个 alert，收窄到错误文案后通过；不是跳过断网断言。

本次仅推进 I5 前置会话部分；商品编辑/下架、Demo 与后端事实边界、业务请求失效会话处理和订单 UI 尚未收口。浏览器服务重启不等于数据库重启持久性验收，I5 未完成、未进入 I6，也未运行远端 CI。

## I5 订单入口与真实读取（2026-09-12）

商品探索和详情请求失败时不再回退到浏览器本地商品；页面显式显示加载/错误状态。商品页购买弹窗已改为真实 `/orders` 创建：后端列表版本随 DTO 传递，实物要求收件人、联系方式和地址，数字商品不发送收货信息；动作 payload 和幂等键在请求结果未知时冻结并可重试。金额在订单列表接口保留字符串。

“我的”页认证后读取 `/orders/search?role=buyer|seller`，未认证时仍可看到原 Demo 订单组件但不会假装为后端订单；认证状态下不读取本地订单。旧购买弹窗测试已替换为 Alpha 边界测试，避免用本地持久化结果证明后端订单。

验证：前端 typecheck、lint、188 项单元测试通过。尚未完成商品编辑/下架、订单详情页面、付款/交付/验收/问题/退款/恢复动作和两类完整浏览器业务验收；I5 仍未完成。

商品管理与订单详情已继续接入：认证卖家通过 `/me/listings` 读取自己已发布商品，可按后端版本编辑标题/金额并下架；页面不把本地商品列表当作认证后的事实来源。订单列表进入 `/me/orders/:id` 后读取私有详情，按买卖方和状态显示动作；实物交付要求物流公司/单号，数字交付要求 HTTPS 链接，问题要求描述，验收和恢复要求显式确认。动作沿用同一幂等键，成功后重新读取详情，结果未知时保留重试状态。

新增详情页和商品管理代码已通过 typecheck、Lint、188 项单元测试和生产构建；浏览器业务验收结果见下方 I5 验收记录。

## I5 验收（2026-09-12）

I5 已完成验收。后端专用测试库 `node scripts/with-test-db.mjs`：30/30 通过，覆盖 I1/I2/I4、实物与数字订单、支付/取消竞争、交付、验收/退款竞争、问题/补交、退款/恢复、同键回放、旧恢复回放、私有读取和第三账户越权。测试 schema、随机 runtime role 和 fixture 均由测试结束清理。

真实 Chromium 脚本 `node scripts/check-i5-browser.mjs` 通过：

- 登录、真实同源代理、实物商品下单并提交收件快照；
- 买家模拟付款，卖家交物流公司/单号，买家验收并完成；
- 数字商品下单不展示收货字段，买家付款，卖家提交 HTTPS 交付链接，买家验收并完成；
- 第三账户携带自己的 session/CSRF 读取他人订单返回 404；
- 浏览器运行使用随机账户和隔离 schema，前后端、浏览器、role、schema 均自动关闭或删除。

前端最终检查：typecheck、Lint、188 项单元测试、生产 build 通过。结果未知重试保留原 payload/幂等键；后端 30 项回归覆盖动作竞争和异常退款/恢复。旧 Demo E2E 中依赖本地订单持久化的场景不作为 I5 证据；I6 交接文档已明确标注其 Demo 范围。

## I6 集成与内测交接（2026-09-12）

I6 已开始。CI 现在在 backend job 的专用 `postgres-test` 上安装前端 Chromium 依赖并运行 `node scripts/check-i5-browser.mjs`；脚本通过 `BACKEND_ORIGIN` 接入真实编译后端，创建随机 schema、runtime role 和账户，结束自动清理。该步骤同时覆盖实物/数字下单、付款、卖家交付、买家验收和第三账户私有边界。

本机 I6 检查：后端 typecheck、lint、3 项单元测试通过；前端 typecheck、lint、25 个测试文件共 189 项单元测试、生产 build 通过；后端专用数据库回归 30/30；持久化数据库 DB-10 通过，验证容器重启后历史数据、编译 API 进程重启和约束保持。真实 Chromium I5 验收脚本通过。最终修复提交 `f515080` 的远端 workflow `34738610736` 已通过 `backend` 与 `verify`；其中 backend job 再次执行数据库集成测试和真实 Alpha Chromium 验收。

内测启动顺序：先按 [基础设施说明](../infra/README.md) 初始化忽略的本地密码并启动 `postgres`；按 [backend README](../backend/README.md) 部署迁移并授权运行账号；设置前端 `BACKEND_ORIGIN` 与后端 `APP_ORIGIN`；前端执行 typecheck、lint、test、build。交接账户必须通过显式 provision 脚本创建，密码只经环境或临时忽略文件传递，不写入前端构建参数或仓库。停止 `postgres-validation` 时保留其持久卷，`postgres-test` 仅用于临时 schema 测试。

已知限制：真实钱包/链上结算、注册、图片托管、通知不在 Alpha；旧 Demo 本地订单和 mock 商品 E2E 不证明后端业务；浏览器验收脚本只使用虚拟收货信息和 example.com HTTPS 链接，不执行外部交付访问。当前交接面向本地或受控内测环境，不包含 API 镜像、公开部署、备份恢复、高可用或容量验收。

## I5 复核修复（2026-09-13）

复核发现早期 I5 验收把后端异常回归错误地当作前端异常流程证据。现已补齐：订单详情并行读取交付、问题、退款、模拟结算和事件；数字交付展示 HTTPS 链接与可选提取码，链接使用新窗口及 `noopener noreferrer`；数字和实物都能提交问题；实物退款必须选择 `returnOutcome`；成功动作刷新详情和私有历史。

结果未知命令按账户保存在 sessionStorage，包含冻结的 path、payload 和幂等键。刷新或组件重新挂载后禁用其他动作，只提供“重试原操作”；明确 4xx 或成功后清除。新增单元测试验证网络结果未知、重新挂载和同键同 payload 回放。

浏览器验收改用 URL 中的真实订单 ID，让第三账户携带自己的 session/CSRF 读取该订单并验证 404。新增已提交付款但响应丢失、页面刷新、同键回放；实物问题、退款申请、卖家选择退货结果、退款与库存恢复；数字交付提取码的参与方读取。最终 Chromium 脚本通过，临时 schema、role 和账户自动清理。

发布金额输入改为十进制字符串校验并原样发送，避免 `Number` 预转换损失精度；后端继续按币种 scale 做最终校验。数字商品发布字段改为实际的授权说明和内容版本，不再把交付方式枚举写入内容版本。认证个人页显示后端账户身份并隐藏 mock 信誉与商品，未认证内容明确标记 Demo。

本轮前端 typecheck、lint、25 个测试文件共 189 项测试、生产 build 通过；backend lint 和修复后的真实 Chromium 验收通过。修复提交 `f515080` 的远端 workflow `34738610736` 已完成且 `verify`、`backend` 均成功，I5 正式验收完成。

## I6 交接完成（2026-09-13）

I6 已完成。CI 的 backend job 使用临时 `postgres-test` 运行 30 项数据库回归与真实 Alpha Chromium 流程，结束时停止测试库；最终远端运行成功。持久化 DB-10 已在独立命名卷验证历史升级、数据库容器重启、编译 API 重启和约束保持，验收后停止 `postgres-validation` 并保留卷。

根 README、前后端 README、基础设施说明和文档索引已统一为当前 Alpha 状态。交接人员可按持久开发库、迁移/运行角色、全部迁移、运行授权、私有文件账户预置、后端和前端的顺序复现环境；Demo 浏览器回归与真实 Alpha 浏览器验收已明确区分。
