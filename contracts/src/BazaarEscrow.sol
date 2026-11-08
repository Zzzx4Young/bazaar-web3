// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract BazaarEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum State {
        None,
        Funded,
        Delivered,
        Disputed,
        Released,
        Refunded
    }
    enum Reason {
        Accepted,
        AcceptanceTimeout,
        Undelivered,
        ArbitratorRelease,
        ArbitratorRefund,
        DisputeTimeout
    }

    struct PaymentPermit {
        uint256 schemaVersion;
        bytes32 orderId;
        bytes32 stockId;
        uint256 stockGeneration;
        bytes32 previousOrderId;
        address buyer;
        address refundAddress;
        address seller;
        address token;
        uint256 amountAtoms;
        bytes32 commitmentHash;
        bytes32 intentId;
        uint256 issuedAt;
        uint256 payDeadline;
        bytes32 signerKeyId;
    }

    struct Terms {
        bytes32 orderId;
        bytes32 stockId;
        uint256 stockGeneration;
        bytes32 previousOrderId;
        address buyer;
        address refundAddress;
        address seller;
        address token;
        uint256 amountAtoms;
        bytes32 commitmentHash;
    }

    struct DeliveryPermit {
        uint256 schemaVersion;
        bytes32 credentialId;
        bytes32 orderId;
        address seller;
        bytes32 deliveryVersion;
        bytes32 manifestCommitment;
        uint256 issuedAt;
        uint256 expiresAt;
        bytes32 signerKeyId;
    }

    struct Order {
        State state;
        address buyer;
        address refundAddress;
        address seller;
        uint256 amountAtoms;
        bytes32 stockId;
        uint256 generation;
        uint256 fundedAt;
        uint256 deliveredAt;
        uint256 disputedAt;
        bytes32 credentialId;
        bytes32 deliveryVersion;
        bytes32 manifestCommitment;
    }

    struct Signer {
        address account;
        uint256 validFrom;
        uint256 validUntil;
        bool revoked;
    }
    uint256 public constant PAYMENT_SECONDS = 1800;
    uint256 public constant DELIVERY_SECONDS = 259200;
    uint256 public constant ACCEPTANCE_SECONDS = 604800;
    uint256 public constant DISPUTE_SECONDS = 604800;
    bytes32 public constant PAYMENT_TYPEHASH = keccak256(
        "PaymentPermit(uint256 schemaVersion,bytes32 orderId,bytes32 stockId,uint256 stockGeneration,bytes32 previousOrderId,address buyer,address refundAddress,address seller,address token,uint256 amountAtoms,bytes32 commitmentHash,bytes32 intentId,uint256 issuedAt,uint256 payDeadline,bytes32 signerKeyId)"
    );
    bytes32 public constant DELIVERY_TYPEHASH = keccak256(
        "DeliveryPermit(uint256 schemaVersion,bytes32 credentialId,bytes32 orderId,address seller,bytes32 deliveryVersion,bytes32 manifestCommitment,uint256 issuedAt,uint256 expiresAt,bytes32 signerKeyId)"
    );
    IERC20 public immutable token;
    address public immutable administrator;
    address public immutable arbitrator;
    bool public depositPaused;
    uint256 public outstanding;
    uint256 public totalDeposited;
    uint256 public totalPaid;
    mapping(bytes32 => Order) private records;
    mapping(bytes32 => bytes32) public orderTermsHash;
    mapping(bytes32 => bool) public revokedIntents;
    mapping(bytes32 => bool) public consumedIntents;
    mapping(bytes32 => bool) public consumedCredentials;
    mapping(bytes32 => bytes32) public stockOccupant;
    mapping(bytes32 => uint256) public stockGeneration;
    mapping(uint8 => mapping(bytes32 => Signer)) public signers;
    event Deposited(
        bytes32 indexed orderId,
        bytes32 indexed intentId,
        bytes32 indexed stockId,
        uint256 generation,
        address buyer,
        address refundAddress,
        address seller,
        address token,
        uint256 amountAtoms,
        uint256 timestamp,
        uint256 deliveryDeadline,
        bytes32 termsHash
    );
    event IntentRevoked(
        bytes32 indexed orderId,
        bytes32 indexed intentId,
        bytes32 indexed stockId,
        address buyer,
        uint256 timestamp,
        uint256 payDeadline,
        bytes32 termsHash
    );
    event DeliveryRegistered(
        bytes32 indexed orderId,
        bytes32 indexed credentialId,
        bytes32 deliveryVersion,
        bytes32 manifestCommitment,
        address seller,
        uint256 timestamp,
        uint256 acceptanceDeadline
    );
    event DisputeOpened(
        bytes32 indexed orderId,
        bytes32 evidenceCommitment,
        address buyer,
        uint256 timestamp,
        uint256 disputeDeadline
    );
    event Released(
        bytes32 indexed orderId,
        address indexed recipient,
        address token,
        uint256 amountAtoms,
        uint256 timestamp,
        Reason reason,
        bytes32 reasonCommitment
    );
    event Refunded(
        bytes32 indexed orderId,
        address indexed recipient,
        address token,
        uint256 amountAtoms,
        uint256 timestamp,
        Reason reason,
        bytes32 reasonCommitment
    );
    event SignerChanged(
        uint8 indexed kind,
        bytes32 indexed keyId,
        address account,
        uint256 validFrom,
        uint256 validUntil
    );
    event SignerRevoked(uint8 indexed kind, bytes32 indexed keyId);
    event PauseChanged(bool paused);
    error Invalid();
    error Unauthorized();
    error WrongState();
    error Deadline();
    error InvalidSignature();
    modifier onlyAdmin() {
        if (msg.sender != administrator) {
            revert Unauthorized();
        }
        _;
    }

    constructor(address token_, address admin_, address arbitrator_)
        EIP712("Bazaar Testnet Escrow", "1")
    {
        if (
            token_.code.length == 0 || admin_.code.length == 0 || arbitrator_.code.length == 0
                || admin_ == arbitrator_ || IERC20Metadata(token_).decimals() != 6
        ) {
            revert Invalid();
        }
        token = IERC20(token_);
        administrator = admin_;
        arbitrator = arbitrator_;
    }

    function configureSigner(
        uint8 kind,
        bytes32 keyId,
        address account,
        uint256 validFrom,
        uint256 validUntil
    ) external onlyAdmin {
        if (
            kind > 1 || keyId == 0 || account == address(0) || account.code.length != 0
                || validUntil <= validFrom || signers[kind][keyId].account != address(0)
                || signers[kind][keyId].revoked
        ) {
            revert Invalid();
        }
        signers[kind][keyId] = Signer(account, validFrom, validUntil, false);
        emit SignerChanged(kind, keyId, account, validFrom, validUntil);
    }

    function revokeSigner(uint8 kind, bytes32 keyId) external onlyAdmin {
        if (kind > 1 || keyId == 0 || signers[kind][keyId].revoked) {
            revert Invalid();
        }
        signers[kind][keyId].revoked = true;
        emit SignerRevoked(kind, keyId);
    }

    function setDepositPaused(bool paused) external onlyAdmin {
        depositPaused = paused;
        emit PauseChanged(paused);
    }

    function order(bytes32 id) external view returns (Order memory) {
        return records[id];
    }

    function orders(bytes32 id) external view returns (Order memory) {
        return records[id];
    }

    function paymentDigest(PaymentPermit memory p) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(PAYMENT_TYPEHASH, p)));
    }

    function deliveryDigest(DeliveryPermit memory p) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(DELIVERY_TYPEHASH, p)));
    }

    function orderTermsDigest(PaymentPermit memory p) public pure returns (bytes32) {
        Terms memory t;
        t.orderId = p.orderId;
        t.stockId = p.stockId;
        t.stockGeneration = p.stockGeneration;
        t.previousOrderId = p.previousOrderId;
        t.buyer = p.buyer;
        t.refundAddress = p.refundAddress;
        t.seller = p.seller;
        t.token = p.token;
        t.amountAtoms = p.amountAtoms;
        t.commitmentHash = p.commitmentHash;
        return keccak256(abi.encode(t));
    }

    function _eoa(address actor) private view {
        if (msg.sender != actor || msg.sender != tx.origin || actor.code.length != 0) {
            revert Unauthorized();
        }
    }

    function _signature(
        uint8 kind,
        bytes32 id,
        uint256 issuedAt,
        bytes32 digest,
        bytes calldata signature
    ) private view {
        Signer memory s = signers[kind][id];
        if (
            s.revoked || s.account == address(0) || issuedAt < s.validFrom
                || issuedAt >= s.validUntil || block.timestamp >= s.validUntil
        ) {
            revert InvalidSignature();
        }
        if (ECDSA.recover(digest, signature) != s.account) {
            revert InvalidSignature();
        }
    }

    function _payment(PaymentPermit calldata p, bytes calldata signature) private {
        _eoa(p.buyer);
        if (
            p.schemaVersion != 1 || p.buyer == address(0) || p.orderId == 0 || p.stockId == 0
                || p.intentId == 0 || p.seller == address(0) || p.seller == p.buyer
                || p.seller.code.length != 0 || p.refundAddress != p.buyer
                || p.token != address(token) || p.amountAtoms == 0 || p.commitmentHash == 0
        ) {
            revert Invalid();
        }
        if (
            p.issuedAt > block.timestamp || p.payDeadline != p.issuedAt + PAYMENT_SECONDS
                || block.timestamp >= p.payDeadline
        ) {
            revert Deadline();
        }
        if (
            records[p.orderId].state != State.None || consumedIntents[p.intentId]
                || revokedIntents[p.intentId]
        ) {
            revert WrongState();
        }
        _signature(0, p.signerKeyId, p.issuedAt, paymentDigest(p), signature);
        bytes32 h = orderTermsDigest(p);
        if (orderTermsHash[p.orderId] != 0 && orderTermsHash[p.orderId] != h) {
            revert Invalid();
        }
        orderTermsHash[p.orderId] = h;
    }

    function revokeIntent(PaymentPermit calldata p, bytes calldata signature)
        external
        nonReentrant
    {
        _payment(p, signature);
        revokedIntents[p.intentId] = true;
        emit IntentRevoked(
            p.orderId,
            p.intentId,
            p.stockId,
            p.buyer,
            block.timestamp,
            p.payDeadline,
            orderTermsHash[p.orderId]
        );
    }

    function deposit(PaymentPermit calldata p, bytes calldata signature) external nonReentrant {
        if (depositPaused) {
            revert WrongState();
        }
        _payment(p, signature);
        bytes32 previous = stockOccupant[p.stockId];
        if (previous == 0) {
            if (p.stockGeneration != 0 || p.previousOrderId != 0) {
                revert Invalid();
            }
        } else {
            Order storage old = records[previous];
            if (
                p.previousOrderId != previous || old.state != State.Refunded
                    || old.credentialId != 0 || p.stockGeneration != stockGeneration[p.stockId] + 1
            ) {
                revert Invalid();
            }
        }
        Order storage o = records[p.orderId];
        o.state = State.Funded;
        o.buyer = p.buyer;
        o.refundAddress = p.refundAddress;
        o.seller = p.seller;
        o.amountAtoms = p.amountAtoms;
        o.stockId = p.stockId;
        o.generation = p.stockGeneration;
        o.fundedAt = block.timestamp;
        consumedIntents[p.intentId] = true;
        stockOccupant[p.stockId] = p.orderId;
        stockGeneration[p.stockId] = p.stockGeneration;
        outstanding += p.amountAtoms;
        totalDeposited += p.amountAtoms;
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(p.buyer, address(this), p.amountAtoms);
        if (token.balanceOf(address(this)) - beforeBalance != p.amountAtoms) {
            revert Invalid();
        }
        _emitDeposit(p);
    }

    function _emitDeposit(PaymentPermit calldata p) private {
        emit Deposited(
            p.orderId,
            p.intentId,
            p.stockId,
            p.stockGeneration,
            p.buyer,
            p.refundAddress,
            p.seller,
            p.token,
            p.amountAtoms,
            block.timestamp,
            block.timestamp + DELIVERY_SECONDS,
            orderTermsHash[p.orderId]
        );
    }

    function registerDelivery(DeliveryPermit calldata p, bytes calldata signature)
        external
        nonReentrant
    {
        Order storage o = records[p.orderId];
        _eoa(o.seller);
        if (o.state != State.Funded || consumedCredentials[p.credentialId]) {
            revert WrongState();
        }
        if (
            p.schemaVersion != 1 || p.credentialId == 0 || p.deliveryVersion == 0
                || p.manifestCommitment == 0 || p.seller != o.seller
        ) {
            revert Invalid();
        }
        uint256 end = o.fundedAt + DELIVERY_SECONDS;
        if (
            p.issuedAt > block.timestamp || p.expiresAt <= p.issuedAt || p.expiresAt > end
                || block.timestamp >= p.expiresAt || block.timestamp >= end
        ) {
            revert Deadline();
        }
        _signature(1, p.signerKeyId, p.issuedAt, deliveryDigest(p), signature);
        o.state = State.Delivered;
        o.deliveredAt = block.timestamp;
        o.credentialId = p.credentialId;
        o.deliveryVersion = p.deliveryVersion;
        o.manifestCommitment = p.manifestCommitment;
        consumedCredentials[p.credentialId] = true;
        emit DeliveryRegistered(
            p.orderId,
            p.credentialId,
            p.deliveryVersion,
            p.manifestCommitment,
            p.seller,
            block.timestamp,
            block.timestamp + ACCEPTANCE_SECONDS
        );
    }

    function accept(bytes32 id) external nonReentrant {
        Order storage o = records[id];
        _eoa(o.buyer);
        if (o.state != State.Delivered) {
            revert WrongState();
        }
        if (block.timestamp >= o.deliveredAt + ACCEPTANCE_SECONDS) {
            revert Deadline();
        }
        _pay(id, false, Reason.Accepted, 0);
    }

    function openDispute(bytes32 id, bytes32 evidenceCommitment) external nonReentrant {
        Order storage o = records[id];
        _eoa(o.buyer);
        if (o.state != State.Delivered) {
            revert WrongState();
        }
        if (block.timestamp >= o.deliveredAt + ACCEPTANCE_SECONDS) {
            revert Deadline();
        }
        o.state = State.Disputed;
        o.disputedAt = block.timestamp;
        emit DisputeOpened(
            id, evidenceCommitment, o.buyer, block.timestamp, block.timestamp + DISPUTE_SECONDS
        );
    }

    function settleExpired(bytes32 id) external nonReentrant {
        Order storage o = records[id];
        if (o.state != State.Delivered) {
            revert WrongState();
        }
        if (block.timestamp < o.deliveredAt + ACCEPTANCE_SECONDS) {
            revert Deadline();
        }
        _pay(id, false, Reason.AcceptanceTimeout, 0);
    }

    function refundUndelivered(bytes32 id) external nonReentrant {
        Order storage o = records[id];
        if (o.state != State.Funded) {
            revert WrongState();
        }
        if (block.timestamp < o.fundedAt + DELIVERY_SECONDS) {
            revert Deadline();
        }
        _pay(id, true, Reason.Undelivered, 0);
    }

    /// @param refund True=full buyer refund; false=full fixed seller release.
    function resolveDispute(bytes32 id, bool refund, bytes32 reasonCommitment)
        external
        nonReentrant
    {
        if (msg.sender != arbitrator) {
            revert Unauthorized();
        }
        Order storage o = records[id];
        if (o.state != State.Disputed) {
            revert WrongState();
        }
        if (block.timestamp >= o.disputedAt + DISPUTE_SECONDS) {
            revert Deadline();
        }
        _pay(
            id,
            refund,
            refund ? Reason.ArbitratorRefund : Reason.ArbitratorRelease,
            reasonCommitment
        );
    }

    function refundDisputeTimeout(bytes32 id) external nonReentrant {
        Order storage o = records[id];
        if (o.state != State.Disputed) {
            revert WrongState();
        }
        if (block.timestamp < o.disputedAt + DISPUTE_SECONDS) {
            revert Deadline();
        }
        _pay(id, true, Reason.DisputeTimeout, 0);
    }

    function _pay(bytes32 id, bool refund, Reason reason, bytes32 reasonCommitment) private {
        Order storage o = records[id];
        o.state = refund ? State.Refunded : State.Released;
        outstanding -= o.amountAtoms;
        totalPaid += o.amountAtoms;
        address recipient = refund ? o.refundAddress : o.seller;
        uint256 beforeBalance = token.balanceOf(recipient);
        uint256 beforeEscrow = token.balanceOf(address(this));
        token.safeTransfer(recipient, o.amountAtoms);
        if (
            token.balanceOf(recipient) - beforeBalance != o.amountAtoms
                || beforeEscrow - token.balanceOf(address(this)) != o.amountAtoms
        ) {
            revert Invalid();
        }
        if (refund) {
            emit Refunded(
                id,
                recipient,
                address(token),
                o.amountAtoms,
                block.timestamp,
                reason,
                reasonCommitment
            );
        } else {
            emit Released(
                id,
                recipient,
                address(token),
                o.amountAtoms,
                block.timestamp,
                reason,
                reasonCommitment
            );
        }
    }
}
