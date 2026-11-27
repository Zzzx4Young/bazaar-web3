// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowBase, BazaarEscrow} from "./EscrowBase.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";
import {BazaarTestToken} from "../src/BazaarTestToken.sol";

contract Forwarder {
    function forward(address to, bytes calldata data) external {
        (bool success,) = to.call(data);
        require(success, "forward rejected");
    }
}

contract EscrowRolesTest is EscrowBase {
    function testA16_pauseOnlyNewDepositKeepsRevokeDeliveryAcceptDisputeResolveAndTimeout() public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        fund(p);
        admin(abi.encodeCall(escrow.setDepositPaused, (true)));
        BazaarEscrow.PaymentPermit memory q = permit(2);
        rejectPayment(q, false);
        bytes memory s = paymentSig(q);
        vm.prank(buyer, buyer);
        escrow.revokeIntent(q, s);
        deliver(p.orderId);
        vm.prank(buyer, buyer);
        escrow.accept(p.orderId);
        admin(abi.encodeCall(escrow.setDepositPaused, (false)));
        bytes32 id = disputed(3);
        admin(abi.encodeCall(escrow.setDepositPaused, (true)));
        rule(abi.encodeCall(escrow.resolveDispute, (id, false, bytes32(0))));
        eq(uint256(state(id)), 4);
        admin(abi.encodeCall(escrow.setDepositPaused, (false)));
        id = disputed(4);
        admin(abi.encodeCall(escrow.setDepositPaused, (true)));
        vm.warp(block.timestamp + 604800);
        escrow.refundDisputeTimeout(id);
    }

    function testA18_directEOAAndDelegationAndWrongActorRejected() public {
        BazaarEscrow.PaymentPermit memory p = permit(1);
        bytes memory s = paymentSig(p);
        vm.expectRevert();
        vm.prank(seller, seller);
        escrow.deposit(p, s);
        Forwarder proxy = new Forwarder();
        vm.expectRevert();
        proxy.forward(address(escrow), abi.encodeCall(escrow.deposit, (p, s)));
        vm.etch(buyer, hex"ef01000000000000000000000000000000000000000001");
        rejectPayment(p, false);
        vm.etch(buyer, "");
        vm.etch(seller, hex"00");
        rejectPayment(p, false);
        vm.etch(seller, "");
        fund(p);
        BazaarEscrow.DeliveryPermit memory d = delivery(p.orderId, 33);
        s = sig(22, escrow.deliveryDigest(d));
        vm.expectRevert();
        vm.prank(buyer, buyer);
        escrow.registerDelivery(d, s);
        deliver(p.orderId);
        vm.expectRevert();
        vm.prank(seller, seller);
        escrow.openDispute(p.orderId, bytes32(0));
        vm.expectRevert();
        vm.prank(seller, seller);
        escrow.accept(p.orderId);
    }

    function testA22_immutableArbitratorNoAdminBackdoorOrMigration() public {
        bytes32 id = disputed(1);
        vm.expectRevert();
        escrow.resolveDispute(id, true, bytes32(0));
        vm.prank(vm.addr(21), vm.addr(21));
        vm.expectRevert();
        escrow.resolveDispute(id, true, bytes32(0));
        rejectSafe(
            address(escrow),
            abi.encodeWithSignature("setArbitrator(address)", address(this)),
            Enum.Operation.Call,
            2
        );
        rejectSafe(
            address(escrow),
            abi.encodeWithSignature("withdraw(address,uint256)", address(this), 1),
            Enum.Operation.Call,
            2
        );
        rejectSafe(
            address(escrow),
            abi.encodeWithSignature("upgradeTo(address)", address(this)),
            Enum.Operation.Call,
            2
        );
        BazaarEscrow fresh = new BazaarEscrow(address(token), address(management), address(council));
        eq(token.balanceOf(address(fresh)), 0);
        eq(token.balanceOf(address(escrow)), 1000001);
        eq(escrow.arbitrator(), address(council));
        admin(abi.encodeCall(escrow.setDepositPaused, (true)));
        vm.warp(block.timestamp + 604800);
        escrow.refundDisputeTimeout(id);
    }

    function testA22_actualSafeSingleDoubleDuplicateAndPausedCompromiseBoundary() public {
        bytes32 id = disputed(1);
        bytes memory data = abi.encodeCall(escrow.resolveDispute, (id, false, keccak256("reason")));
        rejectSafe(address(escrow), data, Enum.Operation.Call, 1);
        admin(abi.encodeCall(escrow.setDepositPaused, (true)));
        rule(data);
        eq(token.balanceOf(seller), 1000001);
        rejectSafe(address(escrow), data, Enum.Operation.Call, 2);
    }

    function testA16_extraTokensAreNotPrincipalAndNoSweep() public {
        token.transfer(address(escrow), 100);
        fund(permit(1));
        eq(escrow.outstanding(), 1000001);
        eq(token.balanceOf(address(escrow)), 1000101);
        vm.warp(block.timestamp + 259200);
        escrow.refundUndelivered(bytes32(uint256(1)));
        eq(token.balanceOf(address(escrow)), 100);
    }

    function testA15_tokenFixedSupplyNoMintOrUpgrade() public {
        eq(token.decimals(), 6);
        eq(token.totalSupply(), 1_000_000_000_000);
        (bool success,) =
            address(token).call(abi.encodeWithSignature("mint(address,uint256)", buyer, 1));
        ok(!success);
    }

    function testA22_managementCannotAdjudicateAndCouncilCannotManage() public {
        bytes32 id = disputed(1);
        rejectAdmin(abi.encodeCall(escrow.resolveDispute, (id, true, bytes32(0))));
        rejectSafe(
            address(escrow), abi.encodeCall(escrow.setDepositPaused, (true)), Enum.Operation.Call, 2
        );
        vm.expectRevert();
        escrow.setDepositPaused(true);
        vm.expectRevert();
        escrow.configureSigner(
            0, bytes32(uint256(99)), buyer, block.timestamp, block.timestamp + 1 days
        );
        vm.expectRevert();
        escrow.revokeSigner(0, PK);
        eq(uint256(state(id)), 3);
        rule(abi.encodeCall(escrow.resolveDispute, (id, true, bytes32(0))));
    }

    function testA22_positiveControlUnsafeSafeModuleCanReleaseExistingDispute() public {
        // Fresh official Safe with initial 3/2, deliberately WITHOUT our guard.
        createSafe();
        BazaarEscrow unsafeEscrow =
            new BazaarEscrow(address(token), address(management), address(council));
        ok(
            executeFor(
                management,
                address(unsafeEscrow),
                abi.encodeCall(
                    unsafeEscrow.configureSigner,
                    (0, PK, vm.addr(21), block.timestamp, block.timestamp + 30 days)
                ),
                false
            )
        );
        ok(
            executeFor(
                management,
                address(unsafeEscrow),
                abi.encodeCall(
                    unsafeEscrow.configureSigner,
                    (1, DK, vm.addr(22), block.timestamp, block.timestamp + 30 days)
                ),
                false
            )
        );
        vm.prank(buyer, buyer);
        token.approve(address(unsafeEscrow), type(uint256).max);
        BazaarEscrow.PaymentPermit memory p = permit(1);
        bytes memory signature = sig(21, unsafeEscrow.paymentDigest(p));
        vm.prank(buyer, buyer);
        unsafeEscrow.deposit(p, signature);
        BazaarEscrow.DeliveryPermit memory d = delivery(p.orderId, 77);
        signature = sig(22, unsafeEscrow.deliveryDigest(d));
        vm.prank(seller, seller);
        unsafeEscrow.registerDelivery(d, signature);
        vm.prank(buyer, buyer);
        unsafeEscrow.openDispute(p.orderId, bytes32(0));
        ok(
            executeSafe(
                address(council),
                abi.encodeWithSignature("enableModule(address)", address(this)),
                Enum.Operation.Call,
                2
            )
        );
        ok(
            council.execTransactionFromModule(
                address(unsafeEscrow),
                0,
                abi.encodeCall(unsafeEscrow.resolveDispute, (p.orderId, false, bytes32(0))),
                Enum.Operation.Call
            )
        );
        eq(uint256(unsafeEscrow.order(p.orderId).state), 4);
        eq(token.balanceOf(seller), p.amountAtoms);
    }
}

contract RoleSeparationDeploymentTest is EscrowBase {
    function testA22_managementAndArbitrationCannotShareOneAddress() public {
        vm.expectRevert(abi.encodeWithSelector(BazaarEscrow.Invalid.selector));
        new BazaarEscrow(address(token), address(council), address(council));
    }
}
