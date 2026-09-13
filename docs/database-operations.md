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

配置后当前 Codex 进程不会动态获得新工具。新进程必须实际调用 `search_objects` 或执行
一次只读查询，确认工具可调用、当前用户为 `bazaar_observer` 且只发现 `bazaar_observe`
对象，才能把 Codex 集成标记为已验证。独立 MCP 协议验证不替代这项进程级检查。

所有 DDL、DML、迁移、授权和数据清理都通过仓库脚本或明确的迁移流程执行，不通过 MCP。
测试库 55432 可随时丢弃；持久重启和恢复证据使用 55433 的专用验证服务。
