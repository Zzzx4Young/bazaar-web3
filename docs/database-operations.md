# PostgreSQL 本地操作与只读 MCP

更新：2026-09-13。I8-0 为本地开发库提供宿主机 `psql`、脱敏观察角色和 DBHub MCP。
这些入口不改变 Alpha 业务契约，也不授权公开或生产数据库访问。

## 权限分层

| 角色 | 用途 | 入口 |
|---|---|---|
| `bazaar_observer` | 日常诊断，只读 16 个脱敏视图 | `npm run db:psql`、`bazaar-postgres` MCP |
| `bazaar_runtime` | 后端运行时业务读写，无 DDL | `npm run db:psql -- runtime` |
| `bazaar_migrate` | 部署迁移和刷新授权 | `npm run db:psql -- migrate`、迁移命令 |
| `bazaar_admin` | 本机角色/schema 初始化与恢复 | 仅显式管理脚本 |

命令从 `backend/` 执行。`db:psql` 默认选择 observer；启动器拒绝非 loopback、非
`bazaar_dev` 或角色不匹配的连接。密码来自 Git 忽略的 0600 文件，只通过子进程环境传给
`psql`，不进入命令参数。

## Observer 初始化与刷新

本机首次执行：

```bash
npm run build
npm run db:observer:setup
npm run db:psql
```

setup 创建无高权限、无成员关系的 `bazaar_observer` 和由 `bazaar_migrate` 拥有的
`bazaar_observe` schema，生成 `.tmp/i8-observer.env`。对象或文件已存在时命令停止，避免
接管未知配置。

其他环境由管理员在目标应用数据库执行 `infra/scripts/create-observer-role.sql`，再由迁移
角色执行 `npm run db:observer:grant`。每次业务迁移改变表或列后都重新执行 grant；该操作
可重复，并会先撤销 observer 对原始业务 schema 的权限。

16 个视图覆盖账户、商品、订单、快照存在性、库存、预留、交付元数据、问题元数据、
退款、模拟结算、事件、幂等结果、会话状态、汇率快照元数据和迁移状态。它们排除登录名、
密码/会话哈希、标题与描述、收件信息、交付引用/物流/提取码、问题描述、事件备注、幂等
键与摘要和汇率 JSON，避免私有数据及用户自由文本进入查询上下文。

## DBHub MCP

Codex 全局 MCP 名为 `bazaar-postgres`，通过项目的 `start-db-mcp.mjs` 启动固定版本
`@bytebase/dbhub@1.2.0`。wrapper 从 `.tmp/i8-observer.env` 读取连接，DBHub 使用 stdio、
3 秒连接/查询超时、100 行结果上限和只读 `execute_sql`。数据库角色权限是最终边界；
DBHub 的 SQL 分类与只读事务只作为附加限制。

2026-09-13 已通过全新、临时 Codex CLI 进程完成端到端验收。进程自动加载
`bazaar-postgres` skill，随后通过 `bazaar-postgres` MCP 调用 `search_objects` 找到
`bazaar_observe.migration_status`，再调用 `execute_sql` 返回 `bazaar_observer`、只读 `on`、
当前 schema `bazaar_observe` 和 16 个观察视图。该进程未使用 shell、`psql` 或其他数据库
角色访问数据库。以后变更 skill、DBHub 版本、MCP 配置或观察角色后，应重复这两次调用。

所有 DDL、DML、迁移、授权和数据清理都通过仓库脚本或明确的迁移流程执行，不通过 MCP。
测试库 55432 可随时丢弃；持久重启和恢复证据使用 55433 的专用验证服务。

## I8-1 备份恢复

I8-1 已使用宿主机 PostgreSQL 17 `pg_dump`/`pg_restore` 和 55433 专用持久服务完成隔离
恢复演练。`npm run test:backup-restore` 创建随机源库和恢复库，验证 custom archive、6 个
迁移、精确数据、不可变约束、runtime/observer 权限、恢复后业务写入及容器重启，结束自动
删除数据库、角色和私有 archive。执行方式、证据和未覆盖的生产边界见
[备份恢复验证](database-backup-recovery.md)。
