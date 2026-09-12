# 多币种与 USD 参考价排序

更新：2026-09-12。用户要求支持全球范围较主流的币种，并换算为 USDT 或 USD 后比较。本阶段选择 USD 作为统一参考基准，取代原 C2 的“价格排序必须限定同币种”草案。当前为 I2 待实现契约。

## 币种范围与精度

首版工程白名单为 USD、EUR、GBP、JPY、CNY、CAD、AUD、CHF、HKD、SGD、KRW、INR、AED、BRL，以及 BTC、ETH、USDT、USDC、SOL。覆盖多地区常用计价需求，不声称覆盖所有国家或按市值动态追踪“主流”。新增币种需同时补齐精度、汇率覆盖和测试，不直接开放供应商返回的所有代码。

| 币种 | 最大小数位 |
|---|---|
| JPY、KRW | 0 |
| 其他首版法币 | 2 |
| USDT、USDC | 6 |
| BTC | 8 |
| SOL | 9 |
| ETH | 18 |

这是 Alpha 应用计价规则，不是链上转账能力。商品输入/输出和订单快照保留原金额十进制字符串、原币种；整数最多 20 位，拒绝零/负/超精度，不舍入。TEST 只用于原数据库实验，不允许公开接口创建。

## 汇率来源与快照

首版采用 Coinbase 公开 `/v2/exchange-rates?currency=USD`，官方说明该端点无需认证，返回每单位基准币对应的其他币数量，汇率为字符串。无需接交易、钱包、账户或支付权限。[官方接口](https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates)。

将 `rates[C]` 理解为 1 USD 对应的 C 数量，故 `usdPerUnit[C] = 1 / rates[C]`；USD 自身为 1。USDT/USDC 使用返回的市场参考比值，不硬编码 1:1。使用高精度 Decimal（至少 80 位有效数字），转换因子保存到 40 位小数；排序在 PostgreSQL numeric 上计算 `priceAmount * usdPerUnit`，不先四舍五入到美分，不经 JS Number 计算。

每个不可变快照保存 id、provider、fetchedAt、expiresAt 和全白名单汇率。有效期 5 分钟；第一笔排序请求复用有效快照，否则在数据库事务外抓取并保存，进程内合并并发刷新。固定 HTTPS 地址、3 秒超时、最大 128 KiB 响应，不跟随重定向；验证响应基准为 USD、全部白名单值为有限正十进制字符串。缺失任一支持币种时拒绝新快照，不把缺失价格当 0。

该供应商响应不提供每个币种的行情发生时间，因此 fetchedAt 仅表示本服务获取时间，sourceAsOf 返回 null；不能标成“实时成交价”。5 分钟 TTL 限制本服务缓存年龄，不保证上游行情延迟。它只用于参考排序，不改变模拟结算金额。

## API 与降级

- POST /currencies (body `{}`) 返回可用代码及 scale，前端选择器由此驱动，不另外硬编码一份精度。
- POST /listings/search（body 携带 sort=price_asc 或 price_desc） 允许跨币种；currency 为可选过滤条件。返回每项 priceUsd（十进制字符串）及 envelope 的 quote{id,base=USD,provider,fetchedAt,expiresAt,sourceAsOf=null}。
- 第一页不传 quoteId 时选择当前有效快照；后续页面必须回传同一 quoteId。同一快照用固定转换因子排序，以 id 作相同参考价的稳定次级顺序。商品编辑/新增仍可能改变偏移分页结果，不承诺商品集合快照。
- 请求指定的 quoteId 不存在/过期返回 409 FX_SNAPSHOT_EXPIRED，前端提示刷新并回到第一页。后续页漏传 quoteId 返回 400 INVALID_INPUT。
- 汇率拉取失败且无有效快照，价格排序返回 503 FX_UNAVAILABLE；前端展示“参考汇率暂不可用”，可由用户改选最新发布。不得静默使用过期汇率、混排裸金额或删掉某种币的商品。
- newest 列表和商品详情不依赖供应商可用性，参考价可为空；发布、编辑、下单与模拟结算不因汇率不可用而改变原价规则。

展示可将参考价格式化为美元美分，但排序用未截断的参考值；极小正数显示“< $0.01”，避免展示为免费。订单仍清楚显示原币种及模拟结算，不使用参考价重新计价。

## I2 验收增量

使用确定的虚拟汇率测试 CNY/USD/BTC/ETH/USDT 等跨币种顺序、相等参考价的次级顺序、反向汇率计算和极小金额。覆盖超时、非 200、错误基准、缺失币种、零/负/特殊值、过期 quote、跨页固定 quote；异常不影响 newest 和原币种下单。外部服务可用性单独做一次无凭据读取冒烟，不以 mock 测试声称真实行情已接通。
