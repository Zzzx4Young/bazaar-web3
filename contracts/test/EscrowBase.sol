// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Safe} from "@safe-global/safe-contracts/contracts/Safe.sol";
import {SafeProxy} from "@safe-global/safe-contracts/contracts/proxies/SafeProxy.sol";
import {SafeFixture, Enum} from "./SafeFixture.sol";
import {LockedSafeGuard} from "../src/LockedSafeGuard.sol";
import {BazaarEscrow} from "../src/BazaarEscrow.sol";
import {BazaarTestToken} from "../src/BazaarTestToken.sol";

abstract contract EscrowBase is SafeFixture {
    Safe internal management;
    BazaarEscrow internal escrow;
    BazaarTestToken internal token;
    address internal buyer;
    address internal seller;
    bytes32 internal constant PK = keccak256("payment");
    bytes32 internal constant DK = keccak256("delivery");

    function setUp() public virtual {
        vm.chainId(11155111);
        vm.warp(1800000000);
        buyer = vm.addr(11);
        seller = vm.addr(12);
        createSafe();
        LockedSafeGuard guard = new LockedSafeGuard();
        ok(
            executeSafe(
                address(council),
                abi.encodeWithSignature("setGuard(address)", address(guard)),
                Enum.Operation.Call,
                2
            )
        );
        Safe singleton = new Safe();
        management = Safe(payable(address(new SafeProxy(address(singleton)))));
        address[] memory managers = new address[](3);
        managers[0] = vm.addr(201);
        managers[1] = vm.addr(202);
        managers[2] = vm.addr(203);
        management.setup(
            managers, 2, address(0), "", address(0), address(0), 0, payable(address(0))
        );
        ok(
            executeFor(
                management,
                address(management),
                abi.encodeWithSignature("setGuard(address)", address(guard)),
                false
            )
        );
        token = new BazaarTestToken(address(this), 1_000_000_000_000);
        escrow = new BazaarEscrow(address(token), address(management), address(council));
        configure(0, PK, vm.addr(21));
        configure(1, DK, vm.addr(22));
        token.transfer(buyer, 1_000_000_000);
        vm.prank(buyer, buyer);
        token.approve(address(escrow), type(uint256).max);
    }

    function configure(uint8 kind, bytes32 id, address who) internal {
        ok(
            executeFor(
                management,
                address(escrow),
                abi.encodeCall(
                    escrow.configureSigner,
                    (kind, id, who, block.timestamp, block.timestamp + 30 days)
                ),
                false
            )
        );
    }

    function admin(bytes memory data) internal {
        ok(executeFor(management, address(escrow), data, false));
    }

    function rule(bytes memory data) internal {
        ok(executeSafe(address(escrow), data, Enum.Operation.Call, 2));
    }

    function rejectAdmin(bytes memory data) internal {
        executeFor(management, address(escrow), data, true);
    }

    function permit(uint256 n) internal view returns (BazaarEscrow.PaymentPermit memory p) {
        p = BazaarEscrow.PaymentPermit(
            1,
            bytes32(n),
            bytes32(n + 10000),
            0,
            bytes32(0),
            buyer,
            buyer,
            seller,
            address(token),
            1000001,
            keccak256("terms"),
            bytes32(n + 20000),
            block.timestamp,
            block.timestamp + 1800,
            PK
        );
    }

    function paymentSig(BazaarEscrow.PaymentPermit memory p) internal returns (bytes memory) {
        return sig(21, escrow.paymentDigest(p));
    }

    function fund(BazaarEscrow.PaymentPermit memory p) internal {
        bytes memory s = paymentSig(p);
        vm.prank(p.buyer, p.buyer);
        escrow.deposit(p, s);
    }

    function rejectPayment(BazaarEscrow.PaymentPermit memory p, bool revoke) internal {
        bytes memory s = paymentSig(p);
        vm.expectRevert();
        vm.prank(p.buyer, p.buyer);
        if (revoke) {
            escrow.revokeIntent(p, s);
        } else {
            escrow.deposit(p, s);
        }
    }

    function delivery(bytes32 id, uint256 n)
        internal
        view
        returns (BazaarEscrow.DeliveryPermit memory)
    {
        return BazaarEscrow.DeliveryPermit(
            1,
            bytes32(n),
            id,
            seller,
            bytes32(n + 5000),
            keccak256(abi.encode(n)),
            block.timestamp,
            block.timestamp + 1000,
            DK
        );
    }

    function deliver(bytes32 id) internal {
        BazaarEscrow.DeliveryPermit memory d = delivery(id, uint256(id) + 30000);
        bytes memory s = sig(22, escrow.deliveryDigest(d));
        vm.prank(seller, seller);
        escrow.registerDelivery(d, s);
    }

    function disputed(uint256 n) internal returns (bytes32 id) {
        BazaarEscrow.PaymentPermit memory p = permit(n);
        fund(p);
        deliver(p.orderId);
        vm.prank(buyer, buyer);
        escrow.openDispute(p.orderId, keccak256("evidence"));
        return p.orderId;
    }

    function state(bytes32 id) internal view returns (BazaarEscrow.State) {
        return escrow.order(id).state;
    }
}
