// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowBase, BazaarEscrow} from "./EscrowBase.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";

contract FaultToken is ERC20 {
    uint256 public mode;
    address public target;
    bytes public payload;
    bool public blocked;

    constructor(address buyer) ERC20("Fault fixture", "FAULT") {
        _mint(buyer, 1e12);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function set(uint256 m, address t, bytes calldata data) external {
        mode = m;
        target = t;
        payload = data;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (mode == 1) {
            return false;
        }
        if (mode == 2) {
            super.transferFrom(from, to, value - 1);
            return true;
        }
        if (mode == 3) {
            (bool success, bytes memory reason) = target.call(payload);
            blocked =
                !success && bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()"));
        }
        return super.transferFrom(from, to, value);
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (mode == 4) {
            return false;
        }
        if (mode == 5) {
            return super.transfer(to, value - 1);
        }
        if (mode == 6) {
            (bool success, bytes memory reason) = target.call(payload);
            blocked =
                !success && bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()"));
        }
        return super.transfer(to, value);
    }
}

contract EscrowTokenSafetyTest is EscrowBase {
    function faulty()
        internal
        returns (FaultToken t, BazaarEscrow e, BazaarEscrow.PaymentPermit memory p)
    {
        t = new FaultToken(buyer);
        e = new BazaarEscrow(address(t), address(management), address(council));
        ok(
            executeFor(
                management,
                address(e),
                abi.encodeCall(
                    e.configureSigner,
                    (0, PK, vm.addr(21), block.timestamp, block.timestamp + 30 days)
                ),
                false
            )
        );
        p = permit(1);
        p.token = address(t);
        vm.prank(buyer, buyer);
        t.approve(address(e), type(uint256).max);
    }

    function testA15_falseOrWrongIncomingDeltaRollsBackAllState() public {
        (FaultToken t, BazaarEscrow e, BazaarEscrow.PaymentPermit memory p) = faulty();
        bytes memory s = sig(21, e.paymentDigest(p));
        for (uint256 mode = 1; mode <= 2; mode++) {
            t.set(mode, address(0), "");
            vm.expectRevert();
            vm.prank(buyer, buyer);
            e.deposit(p, s);
            eq(e.outstanding(), 0);
            eq(e.totalDeposited(), 0);
            eq(e.stockOccupant(p.stockId), 0);
            ok(!e.consumedIntents(p.intentId));
            eq(e.orderTermsHash(p.orderId), 0);
            eq(t.balanceOf(address(e)), 0);
        }
    }

    function testA15_falseOrWrongOutgoingDeltaRollsBackExit() public {
        (FaultToken t, BazaarEscrow e, BazaarEscrow.PaymentPermit memory p) = faulty();
        bytes memory s = sig(21, e.paymentDigest(p));
        vm.prank(buyer, buyer);
        e.deposit(p, s);
        vm.warp(block.timestamp + 259200);
        for (uint256 mode = 4; mode <= 5; mode++) {
            t.set(mode, address(0), "");
            vm.expectRevert();
            e.refundUndelivered(p.orderId);
            eq(e.outstanding(), p.amountAtoms);
            eq(e.totalPaid(), 0);
            eq(uint256(e.order(p.orderId).state), 1);
            eq(t.balanceOf(address(e)), p.amountAtoms);
        }
        t.set(0, address(0), "");
        e.refundUndelivered(p.orderId);
        eq(e.outstanding(), 0);
    }

    function testA15_actualCallbackReentrancyBlockedAtDepositAndExit() public {
        (FaultToken t, BazaarEscrow e, BazaarEscrow.PaymentPermit memory p) = faulty();
        bytes memory s = sig(21, e.paymentDigest(p));
        t.set(3, address(e), abi.encodeCall(e.deposit, (p, s)));
        vm.prank(buyer, buyer);
        e.deposit(p, s);
        ok(t.blocked());
        vm.warp(block.timestamp + 259200);
        t.set(6, address(e), abi.encodeCall(e.refundUndelivered, (p.orderId)));
        e.refundUndelivered(p.orderId);
        ok(t.blocked());
        eq(e.totalPaid(), p.amountAtoms);
    }
}
