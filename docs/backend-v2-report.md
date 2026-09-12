# V2 数据库事务与迁移验证报告

日期：2026-09-12。状态：V2 实验 schema、两次迁移、DB-01—DB-11 自动化与本机真实 PostgreSQL 验证完成。V1 已提交为 `1ecc043`；本报告描述其后的 V2 工作。正式 schema、认证、业务 HTTP API 和前端联调仍按 C1—C3 推进。

2026-09-12 复核时修复四类结构风险：`numeric > 0` 仍允许 PostgreSQL `NaN`；订单买卖双方、商品类型和收件快照可被直接改写；交付、问题和退款外键没有绑定订单角色；超精度金额可能被数据库静默舍入。对应增加 finite-price CHECK、历史/身份保护触发器、订单角色复合外键，以及写入前金额格式校验。修复后的 schema review、迁移失败回滚和全部回归均通过。

## 实现范围

- [实验 schema](../backend/prisma/schema.prisma)：13 个模型，覆盖虚拟账户、商品、订单/快照/收件信息、库存/reservation、交付、问题、退款申请、模拟结算、事件与幂等。账户没有密码或会话实现。
- [首版迁移](../backend/prisma/migrations/202609110001_experiment/migration.sql)：先使用固定的 Prisma CLI 从 schema 生成 SQL，再审查并补入手写约束，最后包裹 BEGIN/COMMIT。没有自动 seed 或 public schema 建表动作；目标 schema 由显式测试连接选择。
- [兼容升级迁移](../backend/prisma/migrations/202609110002_event_note/migration.sql)：为 OrderEvent 添加可空 note；仅用于已有数据升级实验，不改变历史事件的不可修改规则。
- [订单用例层](../backend/src/orders/order-commands.ts)：创建订单、取消、模拟付款、交付/补交、报告问题、申请/执行退款、验收、恢复库存。
- [事务协议与订单幂等](../backend/src/database/transaction.ts)：READ COMMITTED；幂等键 → Listing → PhysicalInventory → Order 的统一锁顺序。问题/退款在订单锁保护下处理。所有写入共享 Prisma 事务 client。
- [商品命令](../backend/src/listings/listing-commands.ts)、[金额解析](../backend/src/common/money.ts)与[错误映射](../backend/src/common/domain-error.ts)：C1 的模块边界、精度输入和安全错误契约。

实验代码未注册进 AppModule，没有新增业务路由；当前对外仍仅有健康检查。actorId 来自可信虚拟测试身份，不是已经完成认证的公开接口参数。

## 数据库保证与应用保证

数据库保存并验证：

- 复合外键保证订单卖家与商品一致、库存/历史 reservation 关联的订单属于同一商品、库存只能关联 physical 商品。
- 每商品至多一条 active reservation；每订单至多一个 open issue，使用 PostgreSQL 条件唯一索引。
- settlement `(orderId, operation)` 唯一；通过复合外键绑定快照的金额/币种，金额用 numeric(38,18)。`TEST` 和此精度是实验值，未冻结产品币种/精度契约。
- 14 项 CHECK 约束覆盖状态、金额、finite 数值、版本、库存与订单关联的空值规则、退款确认等；退款 approved 明确要求 returnOutcome 非 NULL，避免 CHECK 的三值逻辑漏检。
- 快照、事件、交付和结算使用触发器禁止 UPDATE/DELETE。
- 幂等占位与业务在一个事务中写入；延迟约束触发器拒绝提交缺少 resourceId/resultCode 的记录。同键冲突使用指定唯一键的 `ON CONFLICT DO NOTHING RETURNING`，随后单独查询已提交记录并比较 SHA-256 请求摘要。

订单状态转换、操作主体、退款必须已有付款和买家申请、验收必须已有交付等跨表业务规则由实验用例层在锁内验证，并非全部由数据库 CHECK 保证。恢复库存只追加事件，不改原退款订单；重放旧恢复请求不会释放新订单占用。

## 环境与执行方式

运行版本延续 [V1 报告](backend-validation-report.md)：Node 22.23.1、npm 10.9.8、Nest 12.0.1、Fastify 5.12.1、Prisma CLI/Client/adapter-pg 7.10.0、TypeScript 5.9.3。真实查询返回 PostgreSQL `17.11 (Debian 17.11-1.pgdg12+2)`。本轮没有变更依赖或 lockfile。

事务实验使用 `bazaar_test` / 127.0.0.1:55432；DB-10 使用独立 [Compose 配置](../infra/compose.validation.yaml)，数据库 `bazaar_persistence` / 127.0.0.1:55433、命名卷 `bazaar-validation_validation-data`。DB-10 没有使用 tmpfs 证明持久化，也没有操作开发库。

每轮测试以 `CREATE SCHEMA v2_<随机 UUID>` 建立自己的隔离空间。所有 ORM 查询和参数化 SQL 使用相同 schema；结束时只清理本轮创建的 schema。连接配置要求显式测试 URL，不回退到应用 DATABASE_URL。持久化脚本额外要求专用库名、loopback 端口及 `--restart-compose`，只能重启固定的 postgres-validation 服务。密码从已忽略文件读取，仅经子进程环境传递。

复现命令（仓库根目录）：

```bash
sudo docker compose -f infra/compose.yaml --profile test up -d --wait postgres-test
sudo docker compose -f infra/compose.validation.yaml up -d --wait postgres-validation
cd backend
npm run build
npm run typecheck
npm run lint
npm test
node scripts/with-test-db.mjs
node scripts/with-persistence-db.mjs
```

最后一条会重启专用持久测试容器。若不用仓库密码便捷脚本，显式提供 TEST_DATABASE_URL 后运行 `npm run test:db`；持久化验证显式提供 PERSISTENCE_TEST_DATABASE_URL 后运行 `node scripts/check-persistence.mjs --restart-compose`。需要本机网络、回环端口和 Docker 权限；沙箱内网络失败不能作为数据库实验失败结论。

## 验收结果

| 编号 | 已验证的编排与数据库断言 | 结果 |
|---|---|---|
| DB-01 | 不同买家抢同一实物；一个成功订单/快照/收件快照/事件/幂等结果/active reservation，库存关联唯一成功订单 | 通过 |
| DB-02 | 同账户同键同内容并发与丢响应重试返回同一 ID；另一账户不能回放；只写一套结果 | 通过 |
| DB-03 | 同键不同内容，首请求提交时冲突；首请求回滚后等待方按自己的合法内容创建 | 通过 |
| DB-04 | 强制取消先锁、付款先锁两种竞争；仅一方提交，结算/库存/事件/幂等数量符合终态 | 通过 |
| DB-05 | 已付款、有交付和退款申请的异常订单；验收/退款分别先锁，最终仅 completed 或 refunded；退款金额/币种等于快照 | 通过 |
| DB-06 | 退款保持 refund_hold；恢复、重新售出后重放旧恢复键不改新占用，新键旧订单恢复返回冲突；原订单与退款历史保留 | 通过 |
| DB-07 | 库存、快照、事件、付款/退款结算后注入异常；写入与幂等全部回滚，相同请求随后可成功 | 通过 |
| DB-08 | 下架后取消不重新上架；商品编辑/下单分别先锁，旧版本请求冲突或完整保留旧快照 | 通过 |
| DB-09 | 38 位有效数字金额精确往返；`NaN`/超精度金额、直接重复 reservation/结算、跨商品关联、错金额、修改快照、不完整幂等提交和 NULL 退款确认被拒绝 | 通过 |
| DB-10 | 空 schema 部署首迁移，插入历史订单/快照/事件，再升级；生成差异只添加 note，不丢手写对象；重启持久容器和编译 API 进程后历史数据/约束保留 | 通过 |
| DB-11 | 真实持锁触发 50ms lock_timeout，3 次整体尝试耗尽无残片；注入 PostgreSQL 40001/40P01 验证重试成功/耗尽；唯一/权限/状态错误不重试 | 通过 |

并发用例不是仅 Promise.all：先暂停首事务，再通过第二个连接的 pg_backend_pid 与独立观察连接的 pg_blocking_pids 确认真实等待关系后释放；屏障有超时及 finally 清理。业务提交断言使用新建 Prisma 连接读取，不依赖写入方法返回值。SQLSTATE 40001/40P01 由 PostgreSQL RAISE 注入；本轮没有声称制造了自然发生的序列化冲突或真实双向死锁。

最终检查：构建、严格类型、ESLint 通过；配置/输入校验 3 项通过；数据库集成 23/23 通过（含 schema review、迁移失败回滚和 V2 事务用例）；DB-10 独立持久化脚本通过。额外覆盖数字商品重复销售、订单角色外键、历史身份不可变、实验方法越权、缺少交付/退款申请/退回结果时拒绝操作。前端未改，未重跑浏览器用例；远端 CI 未运行。

## 修正记录

- 首轮 14 项中 13 项通过：跨商品 reservation 测试先撞到订单唯一键，未触达外键。改用未建立 reservation 的异商品订单及关闭状态，独立命中复合外键。
- 复核修复恢复库存时对原退款订单 version/updatedAt 的多余更新，新增原订单完整相等断言。
- 退款 CHECK 明确排除 approved 时 returnOutcome 为 NULL，并由直接 SQL 验证。
- 加强 SQLSTATE 断言时最初误读 Prisma 顶层 meta；根据固定 adapter 的包装结构从 driverAdapterError.cause.originalCode 读取 23514，最终回归通过。

## 下一阶段与边界

V2 证明本实验模型和事务实现可满足上述数据库用例，不等于完整 Alpha 已实现，也不构成容量、备份恢复、生产安全或高可用验收。专用持久库目前保留容器和命名卷，实验 schema 已清理；停止容器不会丢失该卷，但它不是备份。

2026-09-12 C1 已收口，见[核心契约](backend-core-contract.md)和[阶段验收](backend-stage-report.md)：保留三次既有迁移的历史名称和 checksum，追加迁移演进；角色隔离与最终三次迁移持久化已重新验证。下一步补齐后端 CI，再由 C2 确定认证/会话/CSRF、币种精度和价格排序、账户/商品 OpenAPI；C3 定订单/交付接口与纵向实现工单。当前没有会话、HTTP 资源越权、前后端联调、上传、钱包或真实结算。

设计依据：[PostgreSQL 锁监控](https://www.postgresql.org/docs/17/view-pg-locks.html)、[事务级锁超时](https://www.postgresql.org/docs/17/runtime-config-client.html)、[Prisma migrate diff 的功能边界](https://docs.prisma.io/docs/cli/v7/migrate/diff)。Prisma 的空差异不能单独证明触发器/CHECK 正确，因此 DB-10 另外检查系统目录并执行非法写入断言。
