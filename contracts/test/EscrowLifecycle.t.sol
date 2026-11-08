// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowBase, BazaarEscrow} from "./EscrowBase.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";

contract EscrowLifecycleTest is EscrowBase {
    function testA01_exactFundingDeliveryAcceptance() public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        fund(p);
        eq(token.balanceOf(address(escrow)), 1000001);
        eq(escrow.outstanding(), 1000001);
        deliver(p.orderId);
        BazaarEscrow.Order memory o = escrow.order(p.orderId);
        eq(o.credentialId, bytes32(uint256(30001)));
        eq(o.deliveryVersion, bytes32(uint256(35001)));
        eq(o.manifestCommitment, keccak256(abi.encode(uint256(30001))));
        vm.prank(buyer, buyer);
        escrow.accept(p.orderId);
        eq(token.balanceOf(seller), 1000001);
        eq(escrow.outstanding(), 0);
        eq(uint256(state(p.orderId)), 4);
        vm.expectRevert();
        vm.prank(buyer, buyer);
        escrow.accept(p.orderId);
        eq(escrow.order(p.orderId).credentialId, o.credentialId);
    }

    function testA02_threePublicExitsFixedRecipients() public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        fund(p);
        vm.warp(block.timestamp + 259200);
        escrow.refundUndelivered(p.orderId);
        eq(token.balanceOf(buyer), 1_000_000_000);
        p = permit(2);
        fund(p);
        deliver(p.orderId);
        vm.warp(block.timestamp + 604800);
        escrow.settleExpired(p.orderId);
        eq(token.balanceOf(seller), 1000001);
        bytes32 id = disputed(3);
        vm.warp(block.timestamp + 604800);
        escrow.refundDisputeTimeout(id);
        eq(uint256(state(id)), 5);
        eq(escrow.outstanding(), 0);
        vm.expectRevert();
        escrow.refundDisputeTimeout(id);
    }

    function testA03_paymentDeadlineMinusAtPlus() public {
        for (uint256 i; i < 3; i++) {
            BazaarEscrow.PaymentPermit memory p = permit(i + 1);
            uint256 t = p.payDeadline;
            vm.warp(t - 1 + i);
            if (i == 0) {
                fund(p);
            } else {
                rejectPayment(p, false);
            }
        }
    }

    function testA03_deliveryDeadlineMinusAtPlus() public {
        for (uint256 i; i < 3; i++) {
            BazaarEscrow.PaymentPermit memory p = permit(i + 1);
            fund(p);
            uint256 t = block.timestamp + 259200;
            vm.warp(t - 1 + i);
            BazaarEscrow.DeliveryPermit memory d = delivery(p.orderId, i + 40000);
            d.expiresAt = t;
            bytes memory s = sig(22, escrow.deliveryDigest(d));
            if (i == 0) {
                vm.expectRevert();
                escrow.refundUndelivered(p.orderId);
                vm.prank(seller, seller);
                escrow.registerDelivery(d, s);
            } else {
                vm.expectRevert();
                vm.prank(seller, seller);
                escrow.registerDelivery(d, s);
                escrow.refundUndelivered(p.orderId);
            }
        }
    }

    function testA03_acceptDisputeSettleDeadlineMinusAtPlus() public {
        for (uint256 i; i < 3; i++) {
            BazaarEscrow.PaymentPermit memory p = permit(i + 1);
            fund(p);
            deliver(p.orderId);
            uint256 t = block.timestamp + 604800;
            vm.warp(t - 1 + i);
            if (i == 0) {
                vm.expectRevert();
                escrow.settleExpired(p.orderId);
                vm.prank(buyer, buyer);
                escrow.openDispute(p.orderId, bytes32(0));
                vm.expectRevert();
                vm.prank(buyer, buyer);
                escrow.accept(p.orderId);
            } else {
                vm.expectRevert();
                vm.prank(buyer, buyer);
                escrow.openDispute(p.orderId, bytes32(0));
                vm.expectRevert();
                vm.prank(buyer, buyer);
                escrow.accept(p.orderId);
                escrow.settleExpired(p.orderId);
            }
        }
    }

    function testA03_resolveDeadlineMinusAtPlusRealSafe() public {
        for (uint256 i; i < 3; i++) {
            bytes32 id = disputed(i + 1);
            vm.warp(block.timestamp + 604799 + i);
            bytes memory data =
                abi.encodeCall(escrow.resolveDispute, (id, true, keccak256("reason")));
            if (i == 0) {
                vm.expectRevert();
                escrow.refundDisputeTimeout(id);
                rule(data);
                eq(uint256(state(id)), 5);
            } else {
                rejectSafe(address(escrow), data, Enum.Operation.Call, 2);
                escrow.refundDisputeTimeout(id);
            }
        }
    }

    function testA09_disputePreventsOrdinarySettlementAndFirstMappingPersists() public {
        bytes32 id = disputed(1);
        BazaarEscrow.Order memory beforeOrder = escrow.order(id);
        vm.warp(block.timestamp + 604800);
        vm.expectRevert();
        escrow.settleExpired(id);
        escrow.refundDisputeTimeout(id);
        BazaarEscrow.Order memory o = escrow.order(id);
        eq(o.credentialId, beforeOrder.credentialId);
        eq(o.deliveryVersion, beforeOrder.deliveryVersion);
        eq(o.manifestCommitment, beforeOrder.manifestCommitment);
        ok(escrow.consumedCredentials(o.credentialId));
    }

    function testA11_deliveryCredentialExpiresAndCannotOverwriteFirst() public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        fund(p);
        BazaarEscrow.DeliveryPermit memory d = delivery(p.orderId, 501);
        bytes memory s = sig(22, escrow.deliveryDigest(d));
        vm.warp(d.expiresAt);
        vm.expectRevert();
        vm.prank(seller, seller);
        escrow.registerDelivery(d, s);
        deliver(p.orderId);
        d = delivery(p.orderId, 502);
        s = sig(22, escrow.deliveryDigest(d));
        vm.expectRevert();
        vm.prank(seller, seller);
        escrow.registerDelivery(d, s);
        eq(escrow.order(p.orderId).credentialId, bytes32(uint256(30001)));
    }

    function testA03_acceptAtMinusOneAndRevokeBoundary() public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        fund(p);
        deliver(p.orderId);
        vm.warp(block.timestamp + 604799);
        vm.prank(buyer, buyer);
        escrow.accept(p.orderId);
        eq(uint256(state(p.orderId)), 4);
        for (uint256 i; i < 3; i++) {
            p = permit(i + 2);
            bytes memory s = paymentSig(p);
            vm.warp(p.payDeadline - 1 + i);
            if (i > 0) {
                vm.expectRevert();
            }
            vm.prank(buyer, buyer);
            escrow.revokeIntent(p, s);
        }
    }

    function testA11_deliveryExpiresCannotExtendOriginalDeadline() public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        fund(p);
        BazaarEscrow.DeliveryPermit memory d = delivery(p.orderId, 99);
        d.expiresAt = block.timestamp + 259201;
        bytes memory s = sig(22, escrow.deliveryDigest(d));
        vm.expectRevert();
        vm.prank(seller, seller);
        escrow.registerDelivery(d, s);
    }
}
