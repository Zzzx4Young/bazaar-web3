# 演示数据与本地存储契约

状态：当前有效。更新：2026-09-06。类型以 `frontend/src/types/` 为准，静态样本以 `frontend/src/mock/` 为准。

## 数据集

25 件商品、6 个卖家、12 条订单、5 个 Banner、5 个一级分类和一个固定当前用户。各一级分类 5 件；实物 10 件、数字 15 件。样本不是实际库存、交易历史或可交付资产。

`src/lib/mock-data.ts` 导入 JSON，并根据 `categories.json.itemIds` 补充静态商品的 `primaryCategory`。使用 TS 类型断言，不应宣称做了运行时 schema 校验。

## 商品与分类

- `category`：`physical | digital`，表示商品类型。
- `primaryCategory`：`electronics | digital_assets | software_source | game_items | secondhand_fashion`，表示一级分类。新发布必填；兼容旧本地商品时允许缺省，缺省商品仍在全部列表可见，但不归入指定一级分类。
- `price`：`amount: number`、`currency: CNY | USDT | ETH | SOL`，可含静态 `fiatEstimate`。仅供展示，不是链上精度金额或实时汇率。
- 实物字段：`condition`、`shippingMethod`；数字字段：`deliveryType`、`deliveryPreview`。
- `deliveryPreview` 是虚构交付示例，存于浏览器，不提供保密或真实授权保证。
- 媒体为占位资源；当前发布表单不上传文件，也不保存草稿。
- 状态为 `active | locked | sold`；目前发布创建 active，不实现真实库存锁定。
- 静态 ID 为 `item_001` 等；本地发布为 `item_user_...`，不是 UUID。

卖家信息通过 `sellerId` 关联。历史订单与当前商品资料并非严格历史快照，不能用这些样本验证真实账务一致性。

## 本地存储

| Key | JSON 结构 | 写入时机 |
|---|---|---|
| `c2c:items:user-published` | `Item[]` | 发布成功 |
| `c2c:user:favorites` | `string[]` | 收藏切换 |
| `c2c:orders` | `{ state: { userOrders: Order[] }, version: 0 }` | 模拟下单、订单 store 更新/重置；Zustand persist 格式 |

发布不创建订单；购买不执行钱包或支付调用。模拟确认后创建 `pending_fulfillment` 订单，后续发货/交付/结算尚未实现。

商品和收藏挂载后读取 localStorage，同页通过自定义事件同步，其他标签页通过 `storage` 事件同步。订单使用 Zustand persist，在当前页面共享；订单跨标签页实时同步尚未实现。

刷新不会主动清理数据；配额满也不自动清空。发布存储失败会显示错误；收藏失败不假装成功。用户清除站点数据后，本地新增商品、收藏和订单消失，静态 Mock 仍存在。聊天仅存组件内存，重载后消失。

本地数据属于当前浏览器和源，不跨设备同步。本地商品详情链接在其他浏览器不可用。非法 JSON/非数组的商品收藏缓存回退为空；尚未提供完整逐字段迁移与校验。

## 验收

- 发布→详情→刷新仍可见；首页、探索、卖家、收藏、订单使用合并后的商品来源。
- 类别筛选区分同类型下的不同一级分类。
- 两个挂载中的收藏消费者立即同步，快速连续操作不覆盖前一次更新。
- 英文路由下发布和站内跳转保留 `/en`。
- UI 不承诺真实发货、下载授权、退款、鉴定或链上托管。
