// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowBase, BazaarEscrow} from "./EscrowBase.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";

contract EscrowReplayTest is EscrowBase {
    function testA04_revokeBeforeDepositAndDepositBeforeRevoke() public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        bytes memory s = paymentSig(p);
        vm.prank(buyer, buyer);
        escrow.revokeIntent(p, s);
        ok(escrow.revokedIntents(p.intentId));
        rejectPayment(p, false);
        rejectPayment(p, true);
        p = permit(2);
        fund(p);
        rejectPayment(p, true);
        rejectPayment(p, false);
        p.intentId = bytes32(uint256(99999));
        rejectPayment(p, true);
        rejectPayment(p, false);
        eq(token.balanceOf(address(escrow)), 1000001);
    }

    function testA04_fixedTermsBindOnRevokeAllowOnlyNewIntentKeyTime() public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        bytes memory s = paymentSig(p);
        vm.prank(buyer, buyer);
        escrow.revokeIntent(p, s);
        p.intentId = bytes32(uint256(999));
        BazaarEscrow.PaymentPermit memory q =
            abi.decode(abi.encode(p), (BazaarEscrow.PaymentPermit));
        q.amountAtoms++;
        rejectPayment(q, false);
        q = abi.decode(abi.encode(p), (BazaarEscrow.PaymentPermit));
        q.seller = vm.addr(13);
        rejectPayment(q, false);
        q = abi.decode(abi.encode(p), (BazaarEscrow.PaymentPermit));
        q.stockId = bytes32(uint256(777));
        rejectPayment(q, false);
        q = abi.decode(abi.encode(p), (BazaarEscrow.PaymentPermit));
        q.stockGeneration = 1;
        rejectPayment(q, false);
        q = abi.decode(abi.encode(p), (BazaarEscrow.PaymentPermit));
        q.previousOrderId = bytes32(uint256(99));
        rejectPayment(q, false);
        q = abi.decode(abi.encode(p), (BazaarEscrow.PaymentPermit));
        q.commitmentHash = bytes32(uint256(1));
        rejectPayment(q, false);
        fund(p);
        eq(escrow.orderTermsHash(p.orderId), escrow.orderTermsDigest(p));
    }

    function testA04_domainAndPurposeAndBodyMutationRejected() public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        bytes memory s = paymentSig(p);
        vm.chainId(1);
        vm.expectRevert();
        vm.prank(buyer, buyer);
        escrow.deposit(p, s);
        vm.chainId(11155111);
        p.intentId = bytes32(uint256(999));
        vm.expectRevert();
        vm.prank(buyer, buyer);
        escrow.deposit(p, s);
        p = permit(2);
        BazaarEscrow.DeliveryPermit memory d = delivery(p.orderId, 42);
        s = sig(22, escrow.deliveryDigest(d));
        vm.expectRevert();
        vm.prank(buyer, buyer);
        escrow.deposit(p, s);
    }

    function testA15_invalidFixedFieldsAndTime() public {
        for (uint256 i; i < 9; i++) {
            BazaarEscrow.PaymentPermit memory p = permit(i + 1);
            if (i == 0) {
                p.amountAtoms = 0;
            }
            if (i == 1) {
                p.refundAddress = seller;
            }
            if (i == 2) {
                p.seller = buyer;
            }
            if (i == 3) {
                p.seller = address(0);
            }
            if (i == 4) {
                p.token = address(1);
            }
            if (i == 5) {
                p.payDeadline++;
            }
            if (i == 6) {
                p.issuedAt++;
            }
            p.payDeadline++;
            if (i == 7) {
                p.schemaVersion = 2;
            }
            if (i == 8) {
                p.stockId = bytes32(0);
            }
            rejectPayment(p, false);
        }
    }

    function testA11_normalRotationAndPermanentRevocation() public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        configure(0, bytes32(uint256(91)), vm.addr(23));
        fund(p);
        p = permit(2);
        admin(abi.encodeCall(escrow.revokeSigner, (0, PK)));
        rejectPayment(p, false);
        rejectPayment(p, true);
        rejectAdmin(
            abi.encodeCall(
                escrow.configureSigner,
                (0, PK, vm.addr(21), block.timestamp, block.timestamp + 1 days)
            )
        );
        p.signerKeyId = bytes32(uint256(91));
        bytes memory s = sig(23, escrow.paymentDigest(p));
        vm.prank(buyer, buyer);
        escrow.deposit(p, s);
        admin(abi.encodeCall(escrow.revokeSigner, (1, DK)));
        BazaarEscrow.DeliveryPermit memory d = delivery(p.orderId, 55);
        s = sig(22, escrow.deliveryDigest(d));
        vm.expectRevert();
        vm.prank(seller, seller);
        escrow.registerDelivery(d, s);
        bytes32 replacement = bytes32(uint256(92));
        configure(1, replacement, vm.addr(24));
        d.signerKeyId = replacement;
        s = sig(24, escrow.deliveryDigest(d));
        vm.prank(seller, seller);
        escrow.registerDelivery(d, s);
    }

    function testA04_crossEscrowAndSignatureMalleabilityRejected() public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        bytes memory s = paymentSig(p);
        BazaarEscrow other = new BazaarEscrow(address(token), address(management), address(council));
        ok(
            executeFor(
                management,
                address(other),
                abi.encodeCall(
                    other.configureSigner,
                    (0, PK, vm.addr(21), block.timestamp, block.timestamp + 1 days)
                ),
                false
            )
        );
        vm.expectRevert(abi.encodeWithSelector(BazaarEscrow.InvalidSignature.selector));
        vm.prank(buyer, buyer);
        other.deposit(p, s);
        s[64] = bytes1(uint8(0));
        vm.expectRevert();
        vm.prank(buyer, buyer);
        escrow.deposit(p, s);
    }

    function testA04_everyFixedFieldRejectedWithValidPlatformSignature() public {
        BazaarEscrow.PaymentPermit memory original = permit(1);
        bytes memory s = paymentSig(original);
        vm.prank(buyer, buyer);
        escrow.revokeIntent(original, s);
        for (uint256 i; i < 8; i++) {
            BazaarEscrow.PaymentPermit memory p = permit(1);
            p.intentId = bytes32(uint256(99));
            if (i == 0) {
                p.amountAtoms++;
            }
            if (i == 1) {
                p.stockId = bytes32(uint256(99));
            }
            if (i == 2) {
                p.stockGeneration = 1;
            }
            if (i == 3) {
                p.previousOrderId = bytes32(uint256(88));
            }
            if (i == 4) {
                p.buyer = vm.addr(13);
            }
            p.refundAddress = p.buyer;
            if (i == 5) {
                p.seller = vm.addr(14);
            }
            if (i == 6) {
                p.commitmentHash = bytes32(uint256(77));
            }
            if (i == 7) {
                p.refundAddress = seller;
            }
            s = paymentSig(p);
            vm.expectRevert(abi.encodeWithSelector(BazaarEscrow.Invalid.selector));
            vm.prank(p.buyer, p.buyer);
            escrow.deposit(p, s);
        }
        original.intentId = bytes32(uint256(100));
        fund(original);
    }

    function testA11_signerValidityWindowAndUnknownRevocationPermanent() public {
        bytes32 id = bytes32(uint256(89));
        uint256 start = block.timestamp + 10;
        uint256 end = start + 2000;
        admin(abi.encodeCall(escrow.configureSigner, (0, id, vm.addr(21), start, end)));
        BazaarEscrow.PaymentPermit memory p = permit(1);
        p.signerKeyId = id;
        rejectPayment(p, false);
        vm.warp(start);
        p = permit(2);
        p.signerKeyId = id;
        fund(p);
        vm.warp(end - 1);
        p = permit(3);
        p.signerKeyId = id;
        fund(p);
        p = permit(4);
        p.signerKeyId = id;
        vm.warp(end);
        rejectPayment(p, false);
        vm.warp(end + 1);
        rejectPayment(p, false);
        id = bytes32(uint256(90));
        admin(abi.encodeCall(escrow.revokeSigner, (0, id)));
        rejectAdmin(
            abi.encodeCall(
                escrow.configureSigner,
                (0, id, vm.addr(21), block.timestamp, block.timestamp + 1 days)
            )
        );
    }

    function testA15_zeroBuyerCannotBindOrRevokeEvenWithPlatformSignature() public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        p.buyer = address(0);
        p.refundAddress = address(0);
        bytes memory signature = paymentSig(p);
        vm.expectRevert(abi.encodeWithSelector(BazaarEscrow.Invalid.selector));
        vm.prank(address(0), address(0));
        escrow.revokeIntent(p, signature);
    }
}
