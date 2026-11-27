// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowBase, BazaarEscrow} from "./EscrowBase.sol";

contract EscrowVectorsTest is EscrowBase {
    function testExportDeployment() public {
        vm.writeFile(
            ".tmp/local-addresses.json",
            string.concat(
                '{"token":"',
                vm.toString(address(token)),
                '","escrow":"',
                vm.toString(address(escrow)),
                '"}'
            )
        );
    }

    function vector()
        internal
        returns (BazaarEscrow.PaymentPermit memory p, bytes memory signature, string memory json)
    {
        json = vm.readFile(".tmp/t04-vectors.json");
        p = abi.decode(vm.parseJsonBytes(json, ".permitAbi"), (BazaarEscrow.PaymentPermit));
        signature = vm.parseJsonBytes(json, ".signature");
        eq(vm.parseJsonAddress(json, ".escrow"), address(escrow));
        eq(p.token, address(token));
        vm.warp(p.issuedAt);
        admin(
            abi.encodeCall(
                escrow.configureSigner,
                (
                    0,
                    p.signerKeyId,
                    vm.parseJsonAddress(json, ".signerAddress"),
                    p.issuedAt,
                    p.payDeadline + 1
                )
            )
        );
        token.transfer(p.buyer, p.amountAtoms);
        vm.prank(p.buyer, p.buyer);
        token.approve(address(escrow), p.amountAtoms);
    }

    function testT04_actualServiceDigestTermsAndDeposit() public {
        (BazaarEscrow.PaymentPermit memory p, bytes memory signature, string memory json) = vector();
        eq(escrow.paymentDigest(p), vm.parseJsonBytes32(json, ".paymentDigest"));
        eq(escrow.orderTermsDigest(p), vm.parseJsonBytes32(json, ".termsDigest"));
        emit log_named_bytes32("T04 orderId", p.orderId);
        emit log_named_bytes32("T04 intentId", p.intentId);
        emit log_named_bytes32("T04 stockId", p.stockId);
        emit log_named_address("T04 payer and refund", p.buyer);
        emit log_named_address("T04 fixed seller", p.seller);
        emit log_named_uint("L chainId", block.chainid);
        emit log_named_uint("L block timestamp", block.timestamp);
        emit log_named_uint("payer before deposit", token.balanceOf(p.buyer));
        emit log_named_uint("escrow before deposit", token.balanceOf(address(escrow)));
        vm.prank(p.buyer, p.buyer);
        escrow.deposit(p, signature);
        emit log_named_uint("payer after deposit", token.balanceOf(p.buyer));
        emit log_named_uint("escrow after deposit", token.balanceOf(address(escrow)));
        emit log_named_uint("outstanding after deposit", escrow.outstanding());
        eq(escrow.orderTermsHash(p.orderId), vm.parseJsonBytes32(json, ".termsDigest"));
        eq(token.balanceOf(address(escrow)), p.amountAtoms);
        ok(escrow.consumedIntents(p.intentId));
        vm.expectRevert();
        vm.prank(p.buyer, p.buyer);
        escrow.deposit(p, signature);
        vm.expectRevert();
        vm.prank(p.buyer, p.buyer);
        escrow.revokeIntent(p, signature);
    }

    function testT04_actualServiceRevokeWinsAndDepositWins() public {
        (BazaarEscrow.PaymentPermit memory p, bytes memory signature,) = vector();
        vm.prank(p.buyer, p.buyer);
        escrow.revokeIntent(p, signature);
        vm.expectRevert();
        vm.prank(p.buyer, p.buyer);
        escrow.deposit(p, signature);
        ok(escrow.revokedIntents(p.intentId));
    }

    function testT04_contractRefusalsSeparateFromServiceRefusals() public {
        (BazaarEscrow.PaymentPermit memory p, bytes memory signature, string memory json) = vector();
        ok(vm.parseJsonUint(json, ".serviceRefusalCount") >= 3);
        p.amountAtoms++;
        vm.expectRevert(abi.encodeWithSelector(BazaarEscrow.InvalidSignature.selector));
        vm.prank(p.buyer, p.buyer);
        escrow.deposit(p, signature);
        p.amountAtoms--;
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(BazaarEscrow.InvalidSignature.selector));
        vm.prank(p.buyer, p.buyer);
        escrow.deposit(p, signature);
        vm.chainId(11155111);
        vm.warp(p.payDeadline);
        vm.expectRevert(abi.encodeWithSelector(BazaarEscrow.Deadline.selector));
        vm.prank(p.buyer, p.buyer);
        escrow.deposit(p, signature);
        eq(uint256(state(p.orderId)), 0);
        eq(escrow.outstanding(), 0);
        vm.writeFile(
            ".tmp/contract-refusals.json",
            '{"layer":"local EVM contract","tamperedAmount":"InvalidSignature","wrongChain":"InvalidSignature","expired":"Deadline","finalState":"None","outstandingAtoms":"0"}'
        );
    }
}
