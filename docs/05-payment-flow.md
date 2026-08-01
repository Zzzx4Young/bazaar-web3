# 05. 链上支付实现

## 1. 支付流程概览

### 1.1 核心概念

**链上 Escrow(托管)**:
- 资金进入**智能合约**而不是直接给卖家
- 满足条件后,**合约自动放款**
- 平台**不能直接拿走资金**(理论上)

### 1.2 支付模式选择

| 模式 | 说明 | 我们的选择 |
|---|---|---|
| **自管 escrow** | 自己写合约 | **首选** |
| 第三方托管 | 用第三方服务 | 不选 |
| 多签托管 | 用 Safe{Wallet} 等 | 备用 |
| P2P 直接支付 | 不托管 | 不选(无信任) |

## 2. 智能合约设计

### 2.1 EscrowFactory 合约(部署一次)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

contract EscrowFactory is Pausable, Ownable2Step {
    using SafeERC20 for IERC20;

    // Escrow 实现合约地址(可以升级)
    address public implementation;
    
    // 所有 escrow 合约
    mapping(bytes32 => address) public escrows;
    
    // 平台费用(basis points, 100 = 1%)
    uint256 public platformFeeBps = 100;  // 1%
    
    // 平台 fee 收集地址
    address public feeCollector;
    
    // KYC 注册表地址
    address public kycRegistry;
    
    event EscrowCreated(
        bytes32 indexed orderId,
        address indexed escrow,
        address indexed buyer,
        address seller,
        address token,
        uint256 amount
    );
    
    constructor(
        address _implementation,
        address _feeCollector,
        address _kycRegistry
    ) {
        implementation = _implementation;
        feeCollector = _feeCollector;
        kycRegistry = _kycRegistry;
    }
    
    function createEscrow(
        bytes32 orderId,
        address seller,
        address token,
        uint256 amount
    ) external whenNotPaused returns (address) {
        require(escrows[orderId] == address(0), "Escrow exists");
        require(amount > 0, "Amount zero");
        require(seller != address(0), "Invalid seller");
        
        // 部署新 escrow(使用 CREATE2 + salt)
        address escrow = Clones.cloneDeterministic(
            implementation,
            keccak256(abi.encodePacked(orderId))
        );
        
        // 初始化
        EscrowImplementation(payable(escrow)).initialize(
            orderId,
            msg.sender,
            seller,
            token,
            amount,
            platformFeeBps,
            feeCollector
        );
        
        escrows[orderId] = escrow;
        
        // 转移代币
        IERC20(token).safeTransferFrom(msg.sender, escrow, amount);
        
        emit EscrowCreated(orderId, escrow, msg.sender, seller, token, amount);
        return escrow;
    }
    
    // ... 其他管理函数(setFee, setKyc, pause, upgrade)
}
```

### 2.2 EscrowImplementation 合约(逻辑)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract EscrowImplementation is ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    enum State {
        Active,      // 已锁定
        Shipped,     // 卖家已发货
        Completed,   // 已完成(放款)
        Disputed,    // 争议中
        Refunded     // 已退款
    }
    
    bytes32 public orderId;
    address public buyer;
    address public seller;
    address public token;  // ERC20 地址
    uint256 public amount;
    uint256 public platformFeeBps;
    address public feeCollector;
    
    State public state;
    uint256 public shippedAt;
    uint256 public autoReleaseAt;  // 自动确认时间
    address public arbitrator;      // 平台仲裁地址
    
    // 可由工厂合约设置
    bool private initialized;
    
    event Shipped(uint256 indexed shippedAt, uint256 autoReleaseAt);
    event Completed(uint256 amount, uint256 fee);
    event Refunded(uint256 amount);
    event Disputed(address indexed initiator);
    event ArbitratorChanged(address indexed newArbitrator);
    
    modifier onlyBuyer() {
        require(msg.sender == buyer, "Not buyer");
        _;
    }
    
    modifier onlySeller() {
        require(msg.sender == seller, "Not seller");
        _;
    }
    
    modifier onlyArbitrator() {
        require(msg.sender == arbitrator, "Not arbitrator");
        _;
    }
    
    modifier inState(State expected) {
        require(state == expected, "Invalid state");
        _;
    }
    
    function initialize(
        bytes32 _orderId,
        address _buyer,
        address _seller,
        address _token,
        uint256 _amount,
        uint256 _platformFeeBps,
        address _feeCollector
    ) external {
        require(!initialized, "Already initialized");
        initialized = true;
        
        orderId = _orderId;
        buyer = _buyer;
        seller = _seller;
        token = _token;
        amount = _amount;
        platformFeeBps = _platformFeeBps;
        feeCollector = _feeCollector;
        
        // 默认 arbitrator 由工厂合约设置(后续可改)
        arbitrator = msg.sender;  // factory
        state = State.Active;
    }
    
    function setArbitrator(address _arbitrator) external {
        require(msg.sender == arbitrator, "Only arbitrator");
        arbitrator = _arbitrator;
        emit ArbitratorChanged(_arbitrator);
    }
    
    // 卖家标记已发货
    function markShipped(uint256 _autoReleaseSeconds) external onlySeller inState(State.Active) {
        shippedAt = block.timestamp;
        autoReleaseAt = block.timestamp + _autoReleaseSeconds;
        state = State.Shipped;
        emit Shipped(shippedAt, autoReleaseAt);
    }
    
    // 买家确认收货 → 放款
    function confirmReceived() external onlyBuyer inState(State.Shipped) nonReentrant {
        _release();
    }
    
    // 自动确认(7 天后无人操作)
    function autoRelease() external inState(State.Shipped) {
        require(block.timestamp >= autoReleaseAt, "Too early");
        _release();
    }
    
    // 发起争议
    function openDispute() external {
        require(msg.sender == buyer || msg.sender == seller, "Not party");
        require(state == State.Shipped || state == State.Active, "Invalid state");
        state = State.Disputed;
        emit Disputed(msg.sender);
    }
    
    // 仲裁:放款
    function resolveRelease() external onlyArbitrator inState(State.Disputed) nonReentrant {
        _release();
    }
    
    // 仲裁:退款
    function resolveRefund() external onlyArbitrator inState(State.Disputed) nonReentrant {
        state = State.Refunded;
        IERC20(token).safeTransfer(buyer, amount);
        emit Refunded(amount);
    }
    
    // 仲裁:部分退款
    function resolvePartialRefund(uint256 refundAmount) 
        external 
        onlyArbitrator 
        inState(State.Disputed) 
        nonReentrant 
    {
        require(refundAmount <= amount, "Too much");
        
        state = State.Refunded;
        if (refundAmount > 0) {
            IERC20(token).safeTransfer(buyer, refundAmount);
        }
        uint256 sellerAmount = amount - refundAmount;
        if (sellerAmount > 0) {
            IERC20(token).safeTransfer(seller, sellerAmount);
        }
        emit Refunded(refundAmount);
    }
    
    // 仲裁:取消(订单创建后未发货)
    function cancel() external onlyArbitrator inState(State.Active) nonReentrant {
        state = State.Refunded;
        IERC20(token).safeTransfer(buyer, amount);
        emit Refunded(amount);
    }
    
    // 内部放款
    function _release() internal {
        state = State.Completed;
        uint256 fee = (amount * platformFeeBps) / 10000;
        uint256 sellerAmount = amount - fee;
        
        IERC20(token).safeTransfer(seller, sellerAmount);
        if (fee > 0) {
            IERC20(token).safeTransfer(feeCollector, fee);
        }
        emit Completed(sellerAmount, fee);
    }
}
```

### 2.3 关键设计点

**1. 使用 CREATE2 部署**
- 每个订单对应一个独立 escrow 合约
- 订单 ID 作为 salt,确定性地址
- 节省部署成本(用 Clones 代理)

**2. 状态机**
- 严格的状态转移,避免资金被错误释放
- ReentrancyGuard 防重入

**3. 平台费**
- 默认 1% (100 bps)
- 可调整(需多签)
- 在 release 时直接扣除

**4. 自动确认**
- 卖家发货后,7 天无人确认则自动放款
- 防止买家"恶意不确认"

**5. 紧急暂停**
- Factory 合约有 Pausable
- 任意 escrow 可被工厂暂停(平台紧急情况)
- **重要**:这个是中心化组件,需多签控制

## 3. 链下服务设计

### 3.1 事件监听服务

```typescript
// escrow-monitor/src/index.ts
import { ethers } from "ethers";
import { Kafka } from "kafkajs";

const kafka = new Kafka({ brokers: ["kafka:9092"] });
const producer = kafka.producer();

const ESCROW_FACTORY_ABI = ["event EscrowCreated(...)"];

async function start() {
  await producer.connect();
  
  // 多链监听
  const chains = [
    { name: "ethereum", rpc: process.env.ETH_RPC, contract: process.env.ETH_FACTORY },
    { name: "arbitrum", rpc: process.env.ARB_RPC, contract: process.env.ARB_FACTORY },
    { name: "tron", rpc: process.env.TRON_RPC, contract: process.env.TRON_FACTORY },
  ];
  
  for (const chain of chains) {
    const provider = new ethers.JsonRpcProvider(chain.rpc);
    const factory = new ethers.Contract(chain.contract, ESCROW_FACTORY_ABI, provider);
    
    // 监听 EscrowCreated
    factory.on("EscrowCreated", async (orderId, escrow, buyer, seller, token, amount, event) => {
      console.log(`[${chain.name}] Escrow created:`, orderId);
      
      // 1. 发送 Kafka 事件
      await producer.send({
        topic: "escrow.created",
        messages: [{
          key: orderId,
          value: JSON.stringify({
            chain: chain.name,
            orderId,
            escrow,
            buyer,
            seller,
            token,
            amount: amount.toString(),
            txHash: event.log.transactionHash,
            blockNumber: event.log.blockNumber,
          })
        }]
      });
      
      // 2. 等待 N 个区块确认
      await event.log.confirmations(3);
    });
    
    // 监听链上 transfer 到 escrow 合约(兜底)
    // ...
  }
}

start().catch(console.error);
```

### 3.2 订单状态同步服务

```typescript
// order-sync/src/index.ts
import { Kafka } from "kafkajs";

const kafka = new Kafka({ brokers: ["kafka:9092"] });
const consumer = kafka.consumer({ groupId: "order-sync" });

async function start() {
  await consumer.connect();
  await consumer.subscribe({ topic: "escrow.created", fromBeginning: false });
  
  await consumer.run({
    eachMessage: async ({ message }) => {
      const event = JSON.parse(message.value.toString());
      
      // 1. 找到订单
      const order = await db.orders.findOne({ orderId: event.orderId });
      if (!order) {
        console.warn("Order not found:", event.orderId);
        return;
      }
      
      // 2. 验证金额与代币匹配
      if (order.amount !== event.amount) {
        await alert("Amount mismatch", { orderId: event.orderId });
        return;
      }
      
      // 3. 验证买卖方
      if (order.buyer !== event.buyer || order.seller !== event.seller) {
        await alert("Address mismatch", { orderId: event.orderId });
        return;
      }
      
      // 4. 更新订单状态
      await db.orders.update(
        { orderId: event.orderId },
        {
          $set: {
            status: "escrow_locked",
            escrowContract: event.escrow,
            escrowTxHash: event.txHash,
            paidAt: new Date(),
          }
        }
      );
      
      // 5. 通知卖家
      await notify.seller(event.seller, {
        type: "order_paid",
        orderId: event.orderId,
      });
    }
  });
}

start().catch(console.error);
```

## 4. 钱包集成

### 4.1 客户端集成(以 Web 为例)

```typescript
// web/src/lib/wallet.ts
import { createConfig, http } from "wagmi";
import { mainnet, arbitrum, base } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [mainnet, arbitrum, base],
  connectors: [
    injected(),
    walletConnect({
      projectId: process.env.WALLETCONNECT_PROJECT_ID,
    }),
  ],
  transports: {
    [mainnet.id]: http(process.env.ETH_RPC),
    [arbitrum.id]: http(process.env.ARB_RPC),
    [base.id]: http(process.env.BASE_RPC),
  },
});
```

### 4.2 账户抽象(ERC-4337)— 降低门槛

```typescript
// web/src/lib/aa.ts
// 使用 ERC-4337 账户抽象,让用户用 Google/邮箱登录
import { createSmartAccountClient } from "@alchemy/aa-core";
import { sepolia } from "@alchemy/aa-core";

const client = createSmartAccountClient({
  chain: sepolia,
  signer: ...,  // 用户钱包或社交登录
  // 用户可以用邮箱登录,后台自动生成钱包
});
```

**这是降低加密门槛的关键**。MVP 后期引入。

## 5. 多链支持

### 5.1 MVP 阶段支持的链

| 链 | 用途 | 备注 |
|---|---|---|
| **Ethereum L1** | 高价值交易 | gas 高,但最安全 |
| **Arbitrum / Base** | 中等价值 | L2,gas 低 |
| **Tron** | USDT-TRC20 主流 | 用户量大,gas 极低 |
| **TON** | 未来扩展 | Telegram 用户 |

### 5.2 多链架构挑战

| 挑战 | 解决 |
|---|---|
| 多链 escrow 合约 | 工厂合约在每条链部署一次 |
| 统一订单 ID | 用 bytes32 哈希 |
| 跨链事件 | 不支持(用户必须选一条链) |
| 跨链结算 | 不做(用户自管) |

## 6. 关键安全考虑

### 6.1 已知攻击向量

| 攻击 | 防护 |
|---|---|
| **重入** | ReentrancyGuard + 状态检查 |
| **整数溢出** | Solidity 0.8+ 内置 |
| **前跑(front-running)** | 接受(无法避免,价值低) |
| **抢跑(抢单)** | 接受(用户主动行为) |
| **签名重放** | Nonce + EIP-712 |
| **私钥泄露** | 用户自管,平台不背 |
| **合约漏洞** | 审计 + Bug Bounty + Pause |
| **Oracle 操纵** | 不依赖价格 oracle(USDT 是 1:1) |

### 6.2 紧急机制

```solidity
// 紧急暂停 — 由多签触发
function emergencyPause(bytes32 orderId) external onlyMultisig {
    address escrow = escrows[orderId];
    if (escrow != address(0)) {
        EscrowImplementation(payable(escrow)).pause();
    }
}

// 紧急退款(整个工厂)
function emergencyRefundAll() external onlyMultisig whenPaused {
    // 遍历所有 escrow,退款
    // 这是极端情况下的最后手段
}
```

**多签要求**:
- 5 个私钥,任一不同地理位置
- 任一私钥损坏不影响运营
- 3/5 多签

## 7. Gas 优化

### 7.1 用户侧

- 推荐用户用 L2(Arbitrum / Base)— gas 极低
- 提供 gas 代付(用 paymaster)— 后续阶段
- 批量操作(后续 ERC-4337 paymaster)

### 7.2 平台侧

- 用 Clones 模式,部署成本 ~$5/合约(L1)
- 监听用 The Graph,降低节点成本
- 关键操作走 L2

## 8. 测试与部署

### 8.1 测试网

| 链 | 测试网 | 水龙头 |
|---|---|---|
| Ethereum | Sepolia | Alchemy Faucet |
| Arbitrum | Sepolia | Alchemy Faucet |
| Base | Sepolia | Base Faucet |
| Tron | Shasta | Tron Faucet |

### 8.2 部署流程

1. 本地测试(Hardhat / Foundry)
2. 测试网(完整 e2e 测试)
3. **独立审计**(2 家: OpenZeppelin, CertiK, Trail of Bits, Spearbit)
4. **Bug Bounty**(Immunefi)
5. 主网部署(分阶段):
   - 阶段 1:小资金(< $100K TVL)
   - 阶段 2:中资金(< $1M TVL)
   - 阶段 3:完整运营

## 9. 未来扩展(非 MVP)

- **跨链 escrow**: 用户在链 A 锁定,卖家在链 B 收到
- **代币化 escrow**: NFT 化的 escrow 凭证
- **二级市场**: 卖家可以转单
- **自动化市场**: 套利、做市
- **机构版**: 大宗交易
