// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowBase, BazaarEscrow} from "./EscrowBase.sol";

contract EscrowInventoryTest is EscrowBase {
    function testA05_crossOrderExclusionA20_refundGenerationAndOldReplay() public {
        BazaarEscrow.PaymentPermit memory a = permit(1);
        fund(a);
        BazaarEscrow.PaymentPermit memory b = permit(2);
        b.stockId = a.stockId;
        rejectPayment(b, false);
        vm.warp(block.timestamp + 259200);
        escrow.refundUndelivered(a.orderId);
        rejectPayment(a, false);
        b.issuedAt = block.timestamp;
        b.payDeadline = block.timestamp + 1800;
        rejectPayment(b, false);
        b.previousOrderId = a.orderId;
        b.stockGeneration = 2;
        rejectPayment(b, false);
        b.stockGeneration = 1;
        fund(b);
        eq(escrow.stockOccupant(a.stockId), b.orderId);
        eq(escrow.stockGeneration(a.stockId), 1);
        rejectPayment(b, false);
        rejectPayment(a, false);
        a.issuedAt = block.timestamp;
        a.payDeadline = block.timestamp + 1800;
        a.intentId = bytes32(uint256(99999));
        bytes memory fresh = paymentSig(a);
        vm.expectRevert(abi.encodeWithSelector(BazaarEscrow.WrongState.selector));
        vm.prank(buyer, buyer);
        escrow.deposit(a, fresh);
        BazaarEscrow.DeliveryPermit memory d = delivery(a.orderId, 77);
        bytes memory s = sig(22, escrow.deliveryDigest(d));
        vm.expectRevert();
        vm.prank(seller, seller);
        escrow.registerDelivery(d, s);
    }

    function testA20_crossStockPredecessorAndJumpAndRegisteredRefundForbidden() public {
        BazaarEscrow.PaymentPermit memory a = permit(1);
        fund(a);
        BazaarEscrow.PaymentPermit memory other = permit(2);
        fund(other);
        vm.warp(block.timestamp + 259200);
        escrow.refundUndelivered(a.orderId);
        escrow.refundUndelivered(other.orderId);
        BazaarEscrow.PaymentPermit memory b = permit(3);
        b.stockId = a.stockId;
        b.stockGeneration = 1;
        b.previousOrderId = other.orderId;
        rejectPayment(b, false);
        b.previousOrderId = a.orderId;
        fund(b);
        deliver(b.orderId);
        vm.prank(buyer, buyer);
        escrow.openDispute(b.orderId, bytes32(0));
        vm.warp(block.timestamp + 604800);
        escrow.refundDisputeTimeout(b.orderId);
        BazaarEscrow.PaymentPermit memory c = permit(4);
        c.stockId = b.stockId;
        c.stockGeneration = 2;
        c.previousOrderId = b.orderId;
        rejectPayment(c, false);
        eq(escrow.stockOccupant(a.stockId), b.orderId);
    }

    function testA20_settledStockNeverReusableAndVirginRequiresZero() public {
        BazaarEscrow.PaymentPermit memory a = permit(1);
        a.stockGeneration = 1;
        rejectPayment(a, false);
        a.stockGeneration = 0;
        a.previousOrderId = bytes32(uint256(7));
        rejectPayment(a, false);
        a.previousOrderId = 0;
        fund(a);
        deliver(a.orderId);
        vm.prank(buyer, buyer);
        escrow.accept(a.orderId);
        BazaarEscrow.PaymentPermit memory b = permit(2);
        b.stockId = a.stockId;
        b.stockGeneration = 1;
        b.previousOrderId = a.orderId;
        rejectPayment(b, false);
    }
}
