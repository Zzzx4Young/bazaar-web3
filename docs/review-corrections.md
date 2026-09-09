# 蓝图复核登记

更新：2026-09-08。状态：历史复核结论与剩余风险，不是业务规格或任务队列。业务基线见 [规格](server-alpha-spec.md)，实施顺序与 R12 拆分见 [执行计划](execution-plan.md)，用户选择见 [ADR-0002](adr/0002-server-alpha.md)。

原文位置中的 00—10、mvp-spec、mvp-tickets、problem 均指 [archive](archive/README.md) 中的历史文件。归档不表示问题已修复。

## 复核登记

“说明已纠正”不代表业务规则已经决定或实现已经修复。

| ID | 原文位置 | 发现与处置 | 状态 |
|---|---|---|---|
| R01 | 01、07、前端路线 | 实物、账号、源码、NFT、域名混为首发范围；展示不等于交易授权 | Q2 已确认实物二手与授权数字内容；账号/NFT 等未纳入 |
| R02 | 00、07、mvp-spec、ADR | 主网产品、测试网实验、Demo 混用；分别定义阶段与进入条件 | Q1 已确认服务端 Alpha；见 ADR-0002 |
| R03 | mvp-spec A6、problem P5、T-230 | 放款后才下载与先验收后放款冲突；终态后拒绝交付缺少合约内救济 | Q4-4/Q4-5 已确认 Alpha 先验收再完成、完成前双方处理异常；Q4-10 已确认内测无完成后售后，历史合约救济未解决 |
| R04 | 05 §2.2、§6.2 | 卖家可设零秒放款；escrow 无 pause 实现；Factory 仲裁调用链未完整展示 | 示例禁止直接用作实现，待重设计 |
| R05 | mvp-spec §4.1、T-110/T-240 | fund 参数不一致；固定回放 1000 区块不能覆盖任意停机；需去重、确认、重组处理 | 测试网设计前解决 |
| R06 | problem P1/P9 | 多签不是拆分一把密钥；后台邮箱权限不等于 Safe 签名权限 | 原判断更正，权限方案待定 |
| R07 | problem P4、T-230 | T-230 已改 listingId/fileId 及固定文件版本，旧问题仍引用 orderId | 命名文档已修正，未实现 |
| R08 | 01 §3.1、07/08 | 5 亿的 5%—10% 为 2500 万—5000 万；月 GMV 100 万不满足 08 示例盈亏平衡条件 | 算术/交叉说明纠正；商业假设待验证 |
| R09 | mvp-spec §7.3、tickets §8、ADR | 122—132 人天与 17.5 人天不一致；14 周不能作为承诺 | 历史估时撤回；新工单按执行计划编制 |
| R10 | 02/03/10 | 市场、竞品、供应商价格、牌照与申报门槛未逐项证实 | 按目标市场专项核实 |
| R11 | docs 入口、ADR、tickets 页首 | 复核文件缺失、ADR 补充日期不实、“假设已全部确认”失效 | 本轮修正文档 |
| R12 | 当前工程整体 review | 订单写入失败卡住、损坏缓存崩溃、根 README 失真、部署配置、跨币种排序、E2E 未入 CI | 2026-09-09 已修复订单写入、商品缓存与 README；部署、排序、CI 仍待处理，见执行计划 |

## 外部依据

2026-09-07 review 核对的资料如下，不代表所有历史数字已验证：

- [Safe 签名阈值](https://docs.safe.global/advanced/smart-account-concepts)：正常交易按 owner 阈值验证，人员独立性、恢复及模块权限另行评估。
- [Stripe 稳定币支付](https://docs.stripe.com/payments/stablecoin-payments)：不能笼统称其禁止所有加密支付，本项目适用性仍待评估。
- [欧盟撤回权](https://europa.eu/youreurope/citizens/consumers/shopping/returns/index_en.htm)：私人个人卖家交易不适用该 14 天撤回权，不能套到全部 C2C。
- [MiCA 第 59 条](https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-59-authorisation)：按实际提供的加密资产服务评估授权要求。

本轮未执行市场全量调研、法律审查或合约审计。
