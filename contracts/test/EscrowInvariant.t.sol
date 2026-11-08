// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowBase, BazaarEscrow} from "./EscrowBase.sol";
import {TestBase} from "./TestBase.sol";
import {BazaarTestToken} from "../src/BazaarTestToken.sol";

/// @notice Only signs synthetic local test permits. Never used by vector/service tests.
contract EscrowHandler is TestBase {
    BazaarEscrow public immutable escrow;
    BazaarTestToken public immutable token;
    address public immutable buyer;
    address public immutable seller;
    uint256 public next = 1;
    uint256 public successfulDeposits;
    uint256 public successfulExits;
    bytes32[] public ids;

    constructor(BazaarEscrow e, BazaarTestToken t, address b, address s) {
        escrow = e;
        token = t;
        buyer = b;
        seller = s;
    }

    function step(uint8 action, uint256 seed) external {
        if (action % 7 == 0 || ids.length == 0) {
            uint256 n = next++;
            BazaarEscrow.PaymentPermit memory p = BazaarEscrow.PaymentPermit(
                1,
                bytes32(n),
                bytes32(n + 100000),
                0,
                0,
                buyer,
                buyer,
                seller,
                address(token),
                1 + seed % 1000000,
                keccak256("fuzz"),
                bytes32(n + 200000),
                block.timestamp,
                block.timestamp + 1800,
                keccak256("payment")
            );
            bytes memory s = sig(21, escrow.paymentDigest(p));
            vm.prank(buyer, buyer);
            try escrow.deposit(p, s) {
                ids.push(p.orderId);
                successfulDeposits++;
            } catch {}
            return;
        }
        bytes32 id = ids[seed % ids.length];
        if (action % 7 == 1) {
            BazaarEscrow.DeliveryPermit memory d = BazaarEscrow.DeliveryPermit(
                1,
                keccak256(abi.encode(id)),
                id,
                seller,
                id,
                keccak256("manifest"),
                block.timestamp,
                block.timestamp + 1,
                keccak256("delivery")
            );
            bytes memory s = sig(22, escrow.deliveryDigest(d));
            vm.prank(seller, seller);
            try escrow.registerDelivery(d, s) {} catch {}
        } else if (action % 7 == 2) {
            vm.prank(buyer, buyer);
            try escrow.accept(id) {
                successfulExits++;
            } catch {}
        } else if (action % 7 == 3) {
            vm.prank(buyer, buyer);
            try escrow.openDispute(id, 0) {} catch {}
        } else if (action % 7 == 4) {
            vm.warp(block.timestamp + 1 + seed % 604801);
        } else if (action % 7 == 5) {
            try escrow.refundUndelivered(id) {
                successfulExits++;
            } catch {}
            try escrow.settleExpired(id) {
                successfulExits++;
            } catch {}
        } else {
            try escrow.refundDisputeTimeout(id) {
                successfulExits++;
            } catch {}
        }
    }

    function count() external view returns (uint256) {
        return ids.length;
    }
}

contract EscrowInvariantTest is EscrowBase {
    EscrowHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new EscrowHandler(escrow, token, buyer, seller);
    }

    // Foundry invariant target API (not a VM cheatcode).
    function targetContracts() external view returns (address[] memory a) {
        a = new address[](1);
        a[0] = address(handler);
    }

    function invariantA15_balanceCoversOutstandingAndNoOverspend() public view {
        ok(token.balanceOf(address(escrow)) >= escrow.outstanding());
        ok(escrow.totalPaid() <= escrow.totalDeposited());
        eq(escrow.totalDeposited() - escrow.totalPaid(), escrow.outstanding());
        ok(handler.successfulExits() <= handler.successfulDeposits());
        uint256 sum;
        for (uint256 i; i < handler.count(); i++) {
            BazaarEscrow.Order memory o = escrow.order(handler.ids(i));
            if (
                o.state == BazaarEscrow.State.Funded || o.state == BazaarEscrow.State.Delivered
                    || o.state == BazaarEscrow.State.Disputed
            ) {
                sum += o.amountAtoms;
            }
        }
        eq(sum, escrow.outstanding());
    }

    function testFuzzA15_terminalSpendOnlyOnce(uint96 amount, uint8 outcome) public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        p.amountAtoms = 1 + uint256(amount) % 1_000_000_000;
        fund(p);
        if (outcome % 3 == 0) {
            vm.warp(block.timestamp + 259200);
            escrow.refundUndelivered(p.orderId);
            vm.expectRevert();
            escrow.refundUndelivered(p.orderId);
        } else {
            deliver(p.orderId);
            if (outcome % 3 == 1) {
                vm.prank(buyer, buyer);
                escrow.accept(p.orderId);
            } else {
                vm.prank(buyer, buyer);
                escrow.openDispute(p.orderId, 0);
                vm.warp(block.timestamp + 604800);
                escrow.refundDisputeTimeout(p.orderId);
            }
        }
        eq(escrow.totalPaid(), p.amountAtoms);
        eq(escrow.outstanding(), 0);
        eq(token.balanceOf(address(escrow)), 0);
        rejectPayment(p, false);
    }
}
