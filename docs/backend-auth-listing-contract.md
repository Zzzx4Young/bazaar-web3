# C2 认证、账户与商品契约

更新：2026-09-12。状态：工程契约已编制，待实现与行为验收；不是已上线接口。机器可读接口见 [OpenAPI](openapi/alpha.json)。范围以 [ADR-0002](adr/0002-server-alpha.md) 为准：只提供预置账户登录/退出，不开放注册、邀请、邮件找回或账户后台。

## 认证实现选择

使用 Node 22 已有 `node:crypto` 异步 scrypt，不新增原生密码库；参数 N=131072、r=8、p=1，随机盐 16 字节、派生结果 64 字节、maxmem 256 MiB，比较使用 timingSafeEqual。自描述存储格式记录版本、参数、salt 和 hash；解析只接受已支持的参数，不能根据任意存储字符串申请无界内存。当前 Node 22.23.1 单次参数试算 288ms，仅是可运行验证，不是性能承诺。OWASP 优先建议 Argon2id；这里选择运行时已有 scrypt，以免额外原生构建依赖，保留未来重哈希迁移能力。[密码存储依据](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Node API](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)。

预置脚本显式接受登录名、展示名和密码，密码从受限文件/标准输入读取，不放 CLI 参数、仓库或日志；不随启动自动执行，不覆盖已有账户。登录名去除首尾空格、转小写后匹配 `[a-z0-9][a-z0-9_-]{2,63}`，展示名 1—80 字符。密码 15—128 字符且 UTF-8 不超过 512 字节，不做 trim 或 Unicode 规范化。历史无凭据账户不能登录；不生成默认公共密码。

新增 AccountCredential（一对一 accountId、passwordHash、updatedAt）与 Session（tokenHash 主键、accountId、createdAt、expiresAt、revokedAt）采用追加迁移。Session 索引 accountId/expiresAt；到期后拒绝访问，不依赖清理任务。禁用账户每次请求生效；密码重置由显式运维命令更新凭据并撤销其全部会话，同事务完成。

## 会话与请求防护

- 每次登录生成独立 32 字节随机 token；Cookie 保存 base64url token，数据库仅保存 SHA-256 摘要。固定有效期 12 小时，不滑动续期。重新登录轮换当前浏览器旧会话；不采纳客户端提供的会话 ID。
- Cookie 名 `bazaar_session`，HttpOnly、SameSite=Lax、Path=/、无 Domain。HTTPS 环境必须 Secure；HTTP 例外仅用于 loopback 本地开发。退出设置 revokedAt 并清除 Cookie。已在执行的请求不承诺被中途取消。
- 前端通过同源 `/api` 反向代理访问后端，使用 Cookie credentials；不把 token 存 localStorage，不开放通配 credential CORS。仅信任明确配置的 APP_ORIGIN，不根据 Host/X-Forwarded-* 推导可信来源；默认不信任代理 IP。
- 所有写请求（含登录）要求精确匹配 Origin 和 application/json；拒绝缺失/`null`/不匹配 Origin，GET 不改变业务状态。登录用 Origin 防护；登录后的写请求另外要求 `X-CSRF-Token`，值是 `SHA256('csrf:' + rawSessionToken)` 的 hex。登录/会话读取接口返回该值，前端只保存在内存；服务器恒定时间比较。不得将 Cookie/CSRF 写入 URL 或日志。
- 登录、会话和所有私有响应 Cache-Control: no-store。未登录、已过期、撤销、禁用统一 401；不存在账号和错误密码统一 INVALID_CREDENTIALS，并执行同参数 dummy hash，避免明显用户枚举。
- 单进程内测限流：登录 IP 10 次/分钟、规范登录名 5 次/分钟；计数包括成功尝试。计算密码最多并行 2 次，不排无限队列，超限 429＋Retry-After。桶数上限 10000，清理过期桶，达到上限拒绝新键。此配置不用于多实例生产限流结论。

会话 Cookie 与防跨站策略参考 [OWASP Session](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) 和 [CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)；具体时限、路径、限流和 token 派生是本项目工程选择。

## 账户与商品 API

所有路径基于 `/api`，错误统一 `{code, retryable}`，DTO 拒绝未知字段；主体只能从会话取得。

| 接口 | 权限与响应 |
|---|---|
| POST /auth/login | 登录名/密码 → 200 当前账户及 csrfToken，Set-Cookie；错误 401/429 |
| POST /auth/session | 登录 → 200 当前账户及 csrfToken；无有效会话 401 |
| POST /auth/logout | Origin＋有效会话＋CSRF → 204；无有效会话 401 |
| POST /listings/search | 公开商品分页；默认 published，可见已售出的公开历史，但可售状态明确 |
| POST /listings/{id}/detail | published 商品公开详情；withdrawn 返回 404，由卖家从自己的商品列表查看 |
| POST /me/listings | 登录，只返回自己的商品，含 withdrawn |
| POST /listings | 登录＋Origin/CSRF；创建商品，201；实物库存与商品同事务写入 |
| POST /listings/{id}/edit | 所属卖家＋Origin/CSRF；带期望 version；成功返回新版本，冲突 409 |

创建商品不自动重试，响应不明先刷新自己的商品列表；本阶段不承诺商品创建幂等。编辑用版本条件阻止重复应用。订单写操作另有强幂等协议，不复用仅支持 orderId 的结果表存商品 ID。

公开输出必须用显式 DTO：id、seller{id,displayName}、type、title、description、category、price{amount,currency}、publicationStatus、availability、version、licenseDescription/contentVersion、createdAt/updatedAt。不含 loginName、passwordHash、Session、收件/交付信息或私有 ORM relation。自己账户输出 id/loginName/displayName。

创建字段：type physical/digital；title 1—100；description 1—5000；category 1—50；price 字符串；数字内容必填 licenseDescription（1—2000）、contentVersion（1—100），实物禁止这些字段。首版编辑只支持 title、priceAmount、publicationStatus 与 version，至少一项变更；sellerId/type/currency 不可由 patch 修改。首版商品不提供图片上传，现有 Demo 图片不自动进入数据库。

列表采用 page/limit，page 1—1000，limit 1—50、默认 20；默认 newest，createdAt DESC/id DESC；价格排序统一按 USD 参考价与 id，currency 为可选过滤。返回 items/page/limit/hasMore/quote，后续价格页传相同 quoteId，多读一条判定，不要求全库 count。筛选 type/category/currency；卖家列表可按 publicationStatus 筛选。偏移分页允许并发新增/编辑造成跨页变化，接口不承诺商品集合快照。汇率规则见[计价契约](backend-pricing-contract.md)。

## 币种与金额

用户已要求主流多币种和换算后比较。首版 19 个币种、各币种精度、USD 参考价、外部汇率获取与失败处理统一见[计价契约](backend-pricing-contract.md)。所有结算仍模拟，不接链或支付服务。

输入为正十进制字符串，最多 20 位整数，拒绝零价、负值、指数及超精度，不自动舍入；公开金额也用字符串，前端不能经 Number 往返。原币种金额保留到订单快照，USD 只用于参考排序，不重新计价。

## 实现验收

1. 登录错误/不存在账号/禁用账号无信息泄露；Cookie 属性正确；服务重启后会话仍有效，撤销/过期拒绝重放。
2. Origin 缺失/伪造、CSRF 缺失/错误、伪造身份字段、非 JSON 写入被拒绝；攻击请求无业务副作用。
3. 两个预置账户独立浏览器登录，A 发布后 B 可见；B 不能编辑 A 的商品；A 下架后公共接口不再提供，A 自己仍可查看。
4. 实物创建库存原子，数字商品不创建库存；版本竞争仅一次编辑成功；跨币种按同一 USD 快照排序，汇率失败明确降级；超精度输入被拒绝。
5. 实现追加迁移、运行角色授权与带旧数据升级测试。以上是待实现验收门槛，C1 数据库测试不能替代 HTTP/E2E。
