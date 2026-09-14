# PostgreSQL 备份恢复验证

更新：2026-09-14。状态：I8-1 已完成。本文件记录受控环境中的可重复恢复演练，不定义
生产 RPO、RTO、备份周期或保留策略。

## 执行入口

要求宿主机 PostgreSQL 17 client、Docker Compose 和已初始化的 Git 忽略测试密码。从
仓库根目录启动独立持久验证服务：

```bash
sudo docker compose -f infra/compose.validation.yaml up -d --wait postgres-validation
cd backend
npm run test:backup-restore
cd ..
sudo docker compose -f infra/compose.validation.yaml stop postgres-validation
```

脚本只接受 `127.0.0.1:55433/bazaar_persistence` 和显式重启参数，不连接 `bazaar_dev` 或
55432 临时测试库。wrapper 从 `infra/.secrets/postgres_test_password` 读取管理凭据，只经
子进程环境传递。

## 演练内容

每轮创建随机命名的源库、恢复库、migration/runtime/observer 三类受限角色，并完成：

1. 在源库创建应用与观察 schema，部署全部 6 个迁移，应用 runtime 和 observer 授权。
2. 写入虚构账户、凭据、会话、商品、订单、快照、收件信息、库存、事件和幂等记录。
3. 以 migration 角色执行 custom-format `pg_dump`；archive 位于 0700 临时目录且权限为
   0600，并由 `pg_restore --list` 验证可读取且包含业务数据和观察 schema。
4. 以管理员将 archive 恢复到独立空库，`--exit-on-error` 遇到首个恢复错误即失败。
5. 验证 6 个迁移、各类行数、凭据哈希和会话归属保持，Prisma schema 无 drift，订单快照
   不可修改。
6. 验证 runtime 无法读取迁移表或执行 DDL，但可以从恢复状态继续执行付款；验证 observer
   默认只读、仅有 16 个脱敏视图且不能读取源表或执行 DDL。
7. 重启 `postgres-validation`，确认恢复库业务写入仍存在，且源库状态未被恢复库操作改变。
8. 删除本轮数据库、角色、archive 和临时目录；清理失败会使命令返回非零。

脚本只输出阶段名和汇总结果，不输出密码、连接串、凭据哈希、会话 token 或私有业务值。

## 验收证据与边界

2026-09-14 本机演练通过：私有 custom archive、空库恢复、6 个迁移、精确数据、约束、
runtime/observer 权限、恢复后业务写入和数据库重启持久性均符合预期。实现提交 `a1c95cc`
的远端 workflow `34843912602` 中 `verify` 与 `backend` 均成功。

本次证明仓库 schema 和受控测试数据可以备份并恢复，不证明生产灾难恢复能力。进入生产
准备前仍需确定备份调度、保留与删除、静态加密、异地副本、恢复权限、监控告警、定期演练、
WAL/PITR、RPO/RTO 和真实部署环境中的存储故障处理。
