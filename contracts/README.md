# Bazaar 本地测试网托管合约

T06 本地候选实现，尚未部署到 Sepolia；没有真实资产、生产多签或真实 RPC 验收。合约测试和服务端拒签是两层不同的证据，不能互相替代。本目录不接入网站钱包或自动执行资金交易。

## 固定工具和依赖

- Node >=22.12，npm 10.9.8。
- Foundry/Forge 1.5.0（本目录 npm 安装，不修改全局工具），Solidity 0.8.30，EVM Prague。
- OpenZeppelin Contracts 5.4.0、Safe Contracts 1.4.1，版本及完整性记录在 package-lock.json。
- `scripts/bootstrap-solc.mjs` 从官方 Solidity release 下载 Linux x86_64 编译器，先验证固定 SHA-256 再执行，保存在忽略的 `.tools/`。其他平台需准备对应受验证编译器，不回退到未知版本。

```bash
cd contracts
npm ci
npm run tools:solc
mkdir -p .tmp
npm run vectors:addresses
cd ../backend
npm run build
node scripts/with-web3-test-db.mjs node ../contracts/scripts/export-t04-vectors.mjs
cd ../contracts
npm test
npm run test:mutations
```

向量导出使用现有专用55435测试服务内随机业务/安全账本schema，调用实际 `PaymentIntentService.createOrder/read`、收款确认、钱包绑定及独立签发账本；不读取 `.env`，不修改开发库。随机测试签名私钥仅存在于进程内，不导出。`.tmp/t04-vectors.json` 保存本地无效于真实业务的公开凭证数据、摘要及 ABI，不能放入 Git 或当作公开部署授权；`service-refusals.json` 单独记录服务端拒签及签名调用次数。

合约测试读取上述实际向量验证 EIP-712 digest、固定 orderTermsHash、签名和入金结果。`EscrowVectors.t.sol` 不能用手写凭证替代这项接入验证；其他 fuzz/状态测试使用明确标记的本地合成凭证。向量缺失时应先执行导出，不以跳过冒充通过。

## 资金与期限

`BazaarTestToken` 为6位精度、构造时一次铸造的固定总量 BZTEST，无后续铸币、税费、重基或升级入口。测试发行量仅fixture使用，公开测试网总量和分发额度仍未确定。

`BazaarEscrow` 绑定一个代币、独立管理地址及不可变裁决地址；管理与裁决不能使用同一地址。非代理升级。付款固定买家、退款地址、卖家、币种、金额、承诺及库存元组；仅指定EOA直接入金或撤销，退款与结算一次互斥，仅转固定收款人。授权ERC-20不代表已付款。

| 动作 | 截止规则 |
|---|---|
| 入金 | 从凭证生成起1800秒，仅 `now < deadline` |
| 首次交付登记 | 入金起259200秒，截止时禁止登记 |
| 验收／争议 | 首次有效登记起604800秒，截止时拒绝新争议、允许超时结算 |
| 多签裁决／超时退款 | 链上争议起604800秒；裁决仅 `<`，超时退款仅 `>=` |

全部时间为本地EVM区块时间。暂停仅阻止新入金；不阻断撤销、交付、争议或既有退出。到期不会自动发交易。登记永久保存credentialId、deliveryVersion及manifestCommitment，退款不抹去首次登记事实。

跨订单库存使用稳定stockId；首代generation=0、previousOrderId=0。从未登记的退款允许新订单精确推进前代+1；已登记后退款、正常结算均不允许重售。旧订单永不重新入金或登记。服务端“旧意图已失效”的核验不在合约中伪造，合约另行验证实际撤销位、订单状态及库存关系。

`PaymentPermit` 编码与 `backend/src/web3/payment-signer.ts` 对齐：domain `Bazaar Testnet Escrow` / version `1` / chainId / verifyingContract；固定条款摘要采用同一ABI元组。`DeliveryPermit.deliveryVersion` 是bytes32承诺，不直接将UUID当整数；T08需从T05精确版本映射冻结编码并补跨端向量，当前合成交付测试不代表真实文件登记接通。

## 本地多签选择和权限门禁

使用真实 Safe 1.4.1 singleton/proxy，两套独立的3名测试成员／2签阈值，分别管理与裁决；支付、交付签名测试身份均不在成员中。部署fixture没有setup delegatecall、fallback handler或模块，并安装 `LockedSafeGuard`。

本地guard拒绝所有Safe对自身的调用及delegatecall，因此不能变更成员、阈值、模块、fallback handler或移除guard；直接模块执行没有已启用模块。测试包含无guard Safe的可执行正对照，以及安装guard后的对应拒绝。Safe有意使用低于执行所需gas的交易可使执行失败，不能因此认定裁决成功；测试同时验证实际资金终态。

这是固定测试控制身份的最小治理样例，并不代表正式治理／密钥恢复方案已经批准：成员轮换和恢复在该guard下也被关闭。若成员失能，不增加管理员后门，已有争议按7天超时退款；新体系应新部署承接新订单，旧本金不强迁。真实控制人、密钥保管、独立性、恢复流程及实际部署代码／模块／guard状态必须在公开部署前确认。三把测试钥匙由一个测试执行器控制，只证明多签流程，不能宣称独立治理。

## 验收与边界

本地用例覆盖实际T04编码、撤销／入金两种顺序、固定条款、跨链／跨合约、库存代次、严格期限、首次登记持久性、签名轮换／永久撤销、权限分离、暂停与超时退出、转账失败回滚，以及状态序列的资金覆盖和单次支出不变量。

`test:mutations` 在独立 `/tmp` 副本中引入8个已知回归，确认对应行为测试确实失败；不修改本实现，不等价于安全审计。原始RED、GREEN和变更灵敏度日志分别留证。

未验收：真实Sepolia、生产多签及独立治理、代币分发、双源最终性与索引、网页钱包、T05真实交付登记、整套资金系统的进程强杀／重启／数据库断连、完整灾难恢复或真实资金。T07另有局部索引进程SIGKILL演练，不能替代这些整体验收。以上均不得因本地EVM通过而标记完成。

T07增设同版本本地Anvil1.5.0（package-lock锁定），供 `backend/tests/helpers/local-escrow.mjs` 创建随机身份、真实两套Safe/guard与托管部署；只监听回环并按实例清理。两个测试RPC代理仍是同一EVM，不能认定独立供应商。该夹具token授权额度用于反复本地场景，不代表网站已完成按单金额授权流程。完整后端事件/进程演练见backend README。

本轮`npm audit`报告8个依赖条目（1 low、3 high、4 critical），与T06原锁文件中的Safe1.4.1→ethers5.4.0/elliptic6.5.4/ws7.4.6及solc0.8.30→tmp0.0.33版本一致，非新增Anvil告警。当前流程只读取Safe Solidity源码，使用受核验原生solc/Forge及viem签名，不加载Safe ethers JS SDK或solc JS CLI；这不能认定告警已消除。依赖治理/隔离仍列公开部署前置项，未为此擅自升级既定Safe合约候选。
