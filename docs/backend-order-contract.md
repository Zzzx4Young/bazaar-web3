# C3 订单与交付契约

更新：2026-09-12。状态：接口与实现工单已编制，业务 HTTP 尚未实现。沿用 [业务规格](server-alpha-spec.md)、[C1 核心契约](backend-core-contract.md) 和 [C2 认证契约](backend-auth-listing-contract.md)。机器契约见 [OpenAPI](openapi/alpha.json)，实施验收见[工单](backend-implementation-tasks.md)。

## 读取、权限与隐私

所有订单接口必须登录。POST /orders 只返回当前账户参与的订单，可筛选 role=buyer/seller、status，按 createdAt DESC/id DESC，page 1—1000、limit 1—50，默认 20。订单摘要包含 id/listingId/buyerId/sellerId/status/version、标题/类型/精确金额快照与时间，不包含地址、链接或提取码。

POST /orders/{id}/detail 返回参与方可见的订单详情及不可变商品/收件快照。交付、问题、退款、结算和事件分别通过 /orders/{id}/deliveries、/issues、/refunds、/settlements、/events 分页读取；都先检查订单参与方，不通过任意 orderId 查询子表后再过滤。非参与方和不存在的订单统一 404。所有私有响应 no-store；输出显式 DTO，不序列化整个 Prisma include。

交付链接仅作为文本存储/展示，不由后端抓取、预览或探测；数字交付仅接受 HTTPS URL，拒绝 URL 用户名/密码，最长 2048；前端新窗口打开时使用 noopener/noreferrer。提取码单独存储、最长 100；实物物流公司 1—100、单号 1—200。订单买卖双方均可读；公开商品/列表/日志不得包含这些值。

## 写操作

所有写操作要求会话、精确 Origin、CSRF、JSON，且请求头 Idempotency-Key 必填，匹配 `[A-Za-z0-9_-]{1,100}`。前端在一次用户动作开始时生成 UUID，网络结果不明时保持原键和完整原请求重试；再次明确发起另一操作才用新键。服务端通过 C1 协议返回 `{orderId}`，首次与回放统一 200；前端成功后重新读取当前状态，不把回放当作原状态快照。

| 路径（POST） | 主体 | 请求与前置条件 | 结果 |
|---|---|---|---|
| /orders | 买家 | listingId、version；实物 shipping{recipient,contact,address}，数字禁止 shipping；非自己商品、published、实物 available | pending_payment，原子占用实物与写快照 |
| /orders/{id}/actions/cancel | 买家 | 空对象；pending_payment | cancelled；仅释放本订单库存，不重新上架 |
| /orders/{id}/actions/pay | 买家 | 空对象；pending_payment | pending_delivery；追加 simulated payment，无真实资金 |
| /orders/{id}/actions/deliver | 卖家 | 实物 carrier/trackingNumber；数字 url/accessCode；pending_delivery 或 issue | 首次 pending_acceptance；补交保持 issue，追加记录 |
| /orders/{id}/actions/issue | 买家 | description 1—2000；pending_delivery 或 pending_acceptance | issue，保存原状态和问题 |
| /orders/{id}/actions/request-refund | 买家 | 空对象；issue，存在 open issue | 追加全额退款请求，订单仍 issue |
| /orders/{id}/actions/accept | 买家 | confirmed=true；pending_acceptance 或 issue，必须已有交付 | completed；解决 open issue，关闭待处理退款；实物 sold |
| /orders/{id}/actions/refund | 卖家 | issue、已有 payment 和买家退款申请；实物 returnOutcome=not_sent/returned/not_required，数字空对象 | refunded；按快照全额模拟退款，实物 refund_hold |
| /orders/{id}/actions/restore | 卖家 | inHandAndResellable=true；已退款实物，库存仍绑定原订单 | 商品库存 available；原订单仍 refunded，追加恢复事件 |

实物 shipping recipient 1—100、contact 1—100、address 1—500。所有字符串除密码外拒绝全空白；不接受请求内 actorId/sellerId、金额、状态、currency、attempts/checkpoint。动作路由映射为已知 OrderAction，不直接将路径字符串强制类型转换。

订单角色在进入 C1 命令前验证；已确认的参与方发起对方专属动作返回 403。版本不符、已占用、非法状态、退款条件和重复的新键请求按 409；输入 400、未登录 401、私有资源不存在/不可见 404、重试耗尽 503。错误不包含 SQL、地址或链接。回放依然要求账户有效及参与关系。

## 对现有实现的必要增量

目前 OrderCommands 已实现状态/事务规则，但不是完整 HTTP 实现：

- 新增 Session/Origin/CSRF guard、安全异常过滤器、各动作 DTO 与参与方读取服务；所有输入验证在进入事务前完成。
- DeliveryRecord 追加可空 carrier/accessCode，保留 reference 作为单号或 URL；旧交付行缺少新增字段可继续读取，不伪造物流公司或提取码。新写入按订单快照类型验证字段。扩展请求摘要以覆盖所有交付字段，防止同键改提取码被误回放。
- 原有实验 `reference` 请求不是公开 API；只用于历史测试。公开 DTO 经显式适配后调用命令，并追加结构化交付测试。确认验收的 confirmed 必须为 true。
- 列表/详情按白名单读，金额转十进制字符串；状态和事件时间使用 UTC ISO 8601。所有追加表/字段同步迁移、授权、幂等摘要与带旧数据升级测试。

## 出口

两种商品均通过 HTTP＋独立浏览器验收；未授权直接请求私有链接/地址被拒绝；真实并发仅一单成功；丢响应重试、付款/取消和验收/退款竞争保持 C1 不变量。补交不自动解决问题，退款不自动恢复实物，恢复重放不清除后续占用；终态无完成后售后入口。容量、公开部署、备份恢复、钱包及真实结算不属于此出口。
