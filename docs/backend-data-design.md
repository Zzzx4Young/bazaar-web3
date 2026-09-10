# 后端逻辑数据模型与关键事务

更新：2026-09-09。状态：工程设计草案，未建表、未运行 SQL；不依赖 ORM。依据：[业务规格](server-alpha-spec.md)、[架构设计](backend-architecture.md)。字段命名为建议，不代表接口已定稿。

## 1. 通用约定

- 主键建议 UUID，时间采用 UTC 的 timestamptz；用户身份来自会话，不接受客户端指定交易主体。
- 金额使用 PostgreSQL 精确 numeric，接口用十进制字符串；最终精度、允许币种和价格排序仍待确认。不直接复用 Demo 的浮点数。
- 公开 DTO、私有数据和数据库实体分离。主键不可猜测不代替权限检查。
- 有历史关联的数据不级联删除；字段校验、外键、唯一约束与应用规则共同保证一致性。跨表状态规则不能假装仅靠 CHECK 即可实现。
- 更新使用 version 或状态条件检查，检测陈旧编辑。数据库 schema、索引 SQL 和版本在 ORM 确认后定稿。

## 2. 实体、字段与关系

| 实体 / 所属模块 | 主要逻辑字段 | 关系与约束 |
|---|---|---|
| Account / 账户 | id、loginName、passwordHash、displayName、status、createdAt | 规范化 loginName 唯一；status 表示账户可用性，不增加管理 UI；无通用管理员角色默认授权 |
| Session / 账户 | id、accountId、tokenHash、expiresAt、revokedAt | N:1 Account；tokenHash 唯一；令牌原文不入库、不记录日志；认证实现待选 |
| Listing / 商品 | id、sellerId、type、title、description、primaryCategory、priceAmount、currency、publicationStatus、version、createdAt、updatedAt | N:1 Account；发布状态 published/withdrawn 与库存分离；physical/digital 类型在发布后不变，避免库存规则切换 |
| Listing 扩展 / 商品 | 实物 condition；数字 licenseDescription、contentVersion；tags、媒体展示引用 | 数字授权及版本作为卖家声明，不证明授权有效；媒体使用占位引用，真实上传待定 |
| Order / 订单 | id、listingId、buyerId、sellerId、status、version、createdAt、updatedAt | 买卖双方不同；指向创建时卖家；状态取自业务规格；不新增完成后售后 |
| OrderSnapshot / 订单 | orderId、listingVersion、title、description、type、category、priceAmount、currency、licenseDescription、contentVersion、媒体展示引用 | 与 Order 1:1；创建时固定，不随商品更新；只存当时展示约定，不能保证外部资源不变 |
| PhysicalInventory / 订单库存 | listingId、availability、activeOrderId、version | 与实物 Listing 1:1；availability 为 available/reserved/sold/refund_hold；非 available 须关联对应订单，关联订单必须属于该商品；数字商品不建此记录 |
| InventoryReservation / 订单库存 | id、listingId、orderId、state、createdAt、closedAt | 每个实物订单一条；state 为 active/cancelled/completed/refunded；同商品至多一条 active；释放不删除历史 |
| OrderShipping / 交付 | orderId、recipient、contact、address | 实物订单私有快照；仅双方可读，内测虚拟值；初期不建设地址簿与下单后改址流程 |
| DeliveryRecord / 交付 | id、orderId、sequence、kind、sellerId、createdAt；物流承运信息/单号或外部链接/提取码 | (orderId,sequence) 唯一；追加不覆写；敏感字段不进入公开接口或普通日志 |
| IssueRecord / 异常 | id、orderId、buyerId、sourceStatus、description、status、createdAt、resolvedAt | 初期同订单至多一条未解决问题；补交保持问题待买家验收，不由卖家自动关闭 |
| RefundRequest / 异常 | id、orderId、issueId、requestedBy、status、approvedBy、returnOutcome、createdAt、approvedAt | 本阶段全额退款；记录买家申请与卖家同意；实物记录未寄出/退回确认/无需退回的事实，不建设退货物流状态流 |
| SettlementRecord / 结算 | id、orderId、mode、operation、amount、currency、createdAt | mode 仅 simulated；operation 为 payment/refund；(orderId,operation) 唯一；金额按订单快照，全额退款须已有付款 |
| OrderEvent / 审计 | id、orderId、actorId、operation、fromState、toState、requestId、createdAt | 追加记录，不含密码、交付链接、提取码、完整地址；与业务变更同事务 |
| IdempotencyRecord / 应用基础 | actorId、operation、key、requestHash、resourceId、resultCode、createdAt | (actorId,operation,key) 唯一；同键不同内容冲突；不保存带私密数据的原始响应 |

库存 activeOrderId 在 sold/refund_hold 时保留对应终态订单，便于追溯。退款关闭 reservation 不等于库存可售；只有卖家明确恢复后将 refund_hold → available 并清除当前关联，历史 reservation 和事件保留。

发布状态与库存共同决定可下单：published 且 available（实物）。下架不取消已有订单；取消未付款订单只释放库存，不将 withdrawn 自动改回 published。

建议索引：公开商品 (publicationStatus,createdAt,id)，卖家商品 (sellerId,createdAt,id)，买家/卖家订单各自 (actorId,createdAt,id)，交付与事件 (orderId,sequence 或 createdAt,id)。按查询确定额外类型/币种索引，不给所有字段盲目建索引。列表采用稳定排序与有上限的分页；搜索与跨币种比较不在此处擅自定规则。

## 3. 统一事务协议

候选实现采用 READ COMMITTED 配合明确行锁/条件更新；不能仅提高隔离级别就省略业务校验。所有相关写入沿用同一事务上下文，不得中途使用全局 Repository 或独立连接。

统一资源锁顺序：幂等键 → Listing → PhysicalInventory（如有）→ Order（如已存在）→ Issue/RefundRequest。审计、交付和结算记录在前述保护下追加。已知 orderId 时可先只读获取不可变 listingId，再按顺序加锁并重新检查状态。商品编辑/下架也锁 Listing 或执行受 version 保护的更新，避免快照读取与编辑交错。

幂等键在同一事务内插入唯一记录；具体采用指定唯一键的 ON CONFLICT DO NOTHING 后分语句读取，避免唯一异常使事务中止，见[验证计划](backend-validation-plan.md)。并发同键请求等待首个事务结束后读取已提交结果；同键不同 requestHash 返回冲突。失败事务回滚幂等记录，允许合法重试；提交成功但响应丢失时返回同一资源，不重复创建。回放仍检查身份、归属，敏感详情通过正常读取路径返回。记录清理期限未定，不能假设删除幂等键后仍可防止相同创建请求重复执行。

锁等待超时/死锁只做有限次数的整体事务重试；重试耗尽返回可重试错误。事务内不请求 RPC、OSS、邮件或其他网络服务。数据库连接预算覆盖 API 实例、后台任务和维护连接。

## 4. 关键用例

### T1 创建实物订单

1. 认证并校验输入、幂等键；使用会话作为 buyerId。
2. 锁商品与库存，校验 published、available、买卖双方不同及提交的商品版本仍有效；价格变动不静默接受。
3. 从数据库商品生成不可变 OrderSnapshot 和私有收件快照；建立待付款订单。
4. 条件占用库存并插入 active reservation；追加事件及幂等结果，同事务提交。
5. 两个不同买家竞争同商品，最多一个成功；中途故障不留下订单或占用残片。数字订单沿用快照协议，但不耗用单件库存。

### T2 取消未付款订单

按统一顺序加锁，检查订单属于当前买家且待付款。置已取消，原订单 reservation 置 cancelled，且仅当 activeOrderId 匹配时释放 reserved 库存。保持商品发布状态不变，提交事件与结果。重复取消不再次释放；付款与取消竞争时仅合法的一方生效。

### T3 模拟付款、交付与验收

模拟付款锁定合法待付款订单；实物还须验证原占用，按快照金额记录 payment 并转待交付。卖家交付追加记录、转待验收；报告问题转异常，补交追加记录但保持异常。买家确认须存在交付记录且满足状态规则；实物 reserved → sold，reservation → completed。每个用例中的状态与记录同事务提交。

### T4 全额模拟退款

检查已付款、订单未完成、买家有效退款申请、卖家身份及必要的实物退回结果。插入唯一 refund，订单转已退款，问题/退款申请关闭；实物 reserved → refund_hold，reservation → refunded。若任一步失败，全部回滚。与买家验收并发时通过同一订单锁序列化，不能同时完成与退款。

### T5 退款后恢复实物可售

卖家显式确认货物在手且可售；锁商品、库存、原退款订单，验证 refund_hold 与对应退款仍匹配。库存转 available，清除当前关联，不改原退款订单、历史 reservation 或发布状态。重复操作不释放新订单占用；若商品已下架仍须单独上架。

## 5. 数据保护与迁移边界

- 无删除用户或订单的 API；后续数据清理需单独定义保留与脱敏方案，不能以级联删除代替。
- seed 显式创建内测账户与样例，迁移不自动导入浏览器 localStorage，不在启动时重置数据。
- 钱包绑定、链事件、区块进度与资金签名密钥不建首期实表；未来结算模式另行迁移和验收，不向模拟记录填造假的链标识。
- MediaAsset 是否建表取决于图片上传范围。对象存储和数据库写入不能伪装为同一事务。

## 6. 验证清单（待实现）

在真实 PostgreSQL 中验证：并发同商品最多一单成功；同键重试结果一致；同键不同请求冲突；付款/取消、验收/退款竞争；退款不自动可售；重复恢复不影响新订单；下架后取消不重新上架；修改商品不改历史快照；事务中断无残留；重启后数据与会话恢复正确；未授权用户无法读取私有交付或变更状态。

ORM 决策见 [比较记录](orm-evaluation.md)。认证细节、图片上传、计价币种及部署目标仍待对应阶段确认；本文件不构成这些产品选择的批准，也未执行数据库验证。
