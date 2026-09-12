# C1 核心与迁移契约

更新：2026-09-12。本文件固化现有数据库与应用用例边界；认证、HTTP DTO 和响应形状由 C2/C3 定义。验收记录见 [阶段报告](backend-stage-report.md)。

## Schema 与迁移基线

正式基线采用 [schema.prisma](../backend/prisma/schema.prisma) 和已有三次迁移：`202609110001_experiment`、`202609110002_event_note`、`202609120001_core_integrity`。目录中的 experiment 是历史名称，不重命名已执行迁移，不改写已有 SQL/checksum；后续变更追加迁移。

数据库负责复合外键、单一 active reservation/open issue、结算唯一、14 项 CHECK、不可变历史与身份、完整幂等结果。应用负责授权、合法状态转换、交付前置条件和退款双方操作。SQL 权限不能替代应用账户级授权。

金额存储上限为 numeric(38,18)，输入必须是正十进制字符串，最多 20 位整数和 18 位小数；拒绝 JS number、指数、特殊数值和隐式舍入。此上限不是产品币种策略；TEST 仅为测试夹具，C2 定义实际可用币种。

新增迁移必须通过空 schema 部署、已有数据升级、Prisma drift 检查及手写约束行为测试。Prisma diff 不覆盖全部 CHECK/触发器，不能单独作为完整性验收。失败迁移先修复数据并验证事务回滚，再显式 resolve --rolled-back 后重试；禁止用 reset 处理需保留的数据。

## 模块契约

| 入口 | 调用方责任 | 返回与原子性 |
|---|---|---|
| `ListingCommands.edit` | 可信 actorId、商品 ID、期望版本、白名单 patch | 返回更新商品；持锁检查所属卖家和版本，版本加一 |
| `OrderCommands.create` | 可信 actorId、幂等键、商品版本、实物收货信息 | 返回 orderId；订单、库存、reservation、快照、事件、幂等结果同事务提交 |
| `OrderCommands.act` | 可信 actorId、幂等键、订单 ID、明确动作与参数 | 返回 orderId；状态、交付/问题/退款/结算、库存及事件同事务提交 |

运行时身份不能从请求 body 的 actorId/buyerId/sellerId 获取。当前模块仅检查账户存在且 active；HTTP 会话认证与 DTO 校验仍待接入。transaction options 和 checkpoint 仅由可信代码提供，不暴露给客户端。

## 事务、锁与幂等

- 使用 READ COMMITTED，锁顺序为幂等记录 → Listing → PhysicalInventory（实物）→ Order（已有订单）。商品编辑使用相同商品/库存锁。不得在事务中调用外部网络、发送消息或执行文件操作。
- 单次事务等待连接最多 3 秒，事务总时限 10 秒，lock_timeout 默认 2 秒；连接池 5，statement_timeout 3 秒。不是整个 HTTP 请求的超时预算。
- 仅 SQLSTATE 55P03、40001、40P01 和 Prisma P2034 重试整个事务；默认最多 3 次，内部允许 1—5 次，退避 attempt × 10ms。耗尽映射 RETRY_EXHAUSTED。权限、唯一约束、状态冲突、取消及未知网络提交结果不自动重试。
- 幂等唯一域是 `(actorId, operation, key)`；键长度 1—100，HTTP 层将进一步限制字符集。请求摘要来自服务端确定字段顺序的规范对象，不能直接 hash 原始请求 JSON。
- INSERT ON CONFLICT DO NOTHING RETURNING 后，冲突方另发 SELECT 取得新快照。摘要相同返回已保存 orderId；不同返回 IDEMPOTENCY_CONFLICT。首次业务失败连同占位回滚，未完成结果不能提交。
- 回放返回原资源 ID，不重复业务；不保证返回最初时刻的整个订单表示。响应丢失时客户端必须使用原键和原内容重试。暂不清理幂等记录，新增模块不能复用只存 orderId 的结果契约。

## 错误边界

`mapApplicationError` 只输出 status/code/retryable：输入 400、权限 403、不存在 404、业务或唯一/外键冲突 409、重试耗尽 503、其他 500 INTERNAL_ERROR。不可将 SQL、驱动报错、密码、地址或交付数据返回给客户端/写入普通日志。当前映射是用例契约，HTTP 异常过滤器在业务路由阶段接入。

## 数据库角色

日常调试仅需持久化 `postgres` 容器。角色是同一个数据库中的账号，不需要额外容器。

| 角色 | 权限 |
|---|---|
| 初始化管理员 | 一次性创建数据库、角色和 schema；不用于应用运行 |
| `bazaar_migrate` | 拥有 bazaar schema 和迁移对象，运行显式 migrate deploy；不是超级用户，不可建库/建角色 |
| `bazaar_runtime` | schema USAGE；13 张业务表显式 SELECT/INSERT；仅可变表 UPDATE；无 DELETE/TRUNCATE/DDL、迁移表权限和迁移角色成员资格 |

初始化管理员用 psql 在目标开发数据库执行 [create-app-roles.sql](../infra/scripts/create-app-roles.sql)，通过交互密码提示设置两个独立密码；脚本遇到已有角色/schema 即失败，不接管对象。若密码设置中断，管理员重新执行对应 `\password`，无需重建角色。将凭据保存到忽略的环境文件/密钥管理工具，不写入仓库。

在 backend/ 构建后，使用迁移账号的 DATABASE_URL（带 `?schema=bazaar`）运行：

```bash
npx prisma migrate deploy
node scripts/grant-runtime.mjs bazaar bazaar_runtime
```

应用 DATABASE_URL 改用运行账号、同一 schema。授权脚本原子执行且可重复，拒绝管理员/拥有 schema/有角色成员资格的运行账号；不自动授权未来表。后续迁移增加表时同步审查授权清单。部署 schema 必须专用，不用于已有共享业务 schema；这不是清理既有账号跨库权限的审计工具。

## 验收边界

角色集成测试使用随机角色和 schema：非超级用户迁移、受限账号商品编辑/下单/付款/交付/验收和幂等回放；断言 DDL、历史修改、迁移记录读取、提权和未来表读取被拒绝，最后只清理本轮创建的对象。

DB-01—DB-11 继续验证事务规则，DB-10 在独立命名卷容器验证历史升级和重启；测试结束可停止验证容器保留卷。数据库角色隔离不代表 HTTP 越权、容量、备份恢复、生产部署或高可用已通过。
