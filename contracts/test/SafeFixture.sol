// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Safe} from "@safe-global/safe-contracts/contracts/Safe.sol";
import {SafeProxy} from "@safe-global/safe-contracts/contracts/proxies/SafeProxy.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";
import {TestBase} from "./TestBase.sol";

abstract contract SafeFixture is TestBase {
    Safe internal council;
    address[] internal owners;

    function createSafe() internal {
        Safe singleton = new Safe();
        council = Safe(payable(address(new SafeProxy(address(singleton)))));
        owners = new address[](3);
        owners[0] = vm.addr(101);
        owners[1] = vm.addr(102);
        owners[2] = vm.addr(103);
        council.setup(owners, 2, address(0), "", address(0), address(0), 0, payable(address(0)));
    }

    function safeSignatures(address to, bytes memory data, Enum.Operation op, uint256 count)
        internal
        returns (bytes memory)
    {
        bytes32 h = council.getTransactionHash(
            to, 0, data, op, 0, 0, 0, address(0), address(0), council.nonce()
        );
        bytes memory a = sig(101, h);
        bytes memory b = sig(102, h);
        if (count == 1) {
            return a;
        }
        return owners[0] < owners[1] ? bytes.concat(a, b) : bytes.concat(b, a);
    }

    function rejectSafe(address to, bytes memory data, Enum.Operation op, uint256 count) internal {
        bytes memory signatures = safeSignatures(to, data, op, count);
        vm.expectRevert();
        council.execTransaction(
            to, 0, data, op, 0, 0, 0, address(0), payable(address(0)), signatures
        );
    }

    function executeSafe(address to, bytes memory data, Enum.Operation op, uint256 count)
        internal
        returns (bool)
    {
        bytes memory signatures = safeSignatures(to, data, op, count);
        return council.execTransaction(
            to, 0, data, op, 0, 0, 0, address(0), payable(address(0)), signatures
        );
    }

    function safeSignaturesFor(
        Safe account,
        uint256 keyA,
        uint256 keyB,
        address to,
        bytes memory data
    ) internal returns (bytes memory) {
        bytes32 h = hashFor(account, to, data);
        bytes memory a = sig(keyA, h);
        bytes memory b = sig(keyB, h);
        return vm.addr(keyA) < vm.addr(keyB) ? bytes.concat(a, b) : bytes.concat(b, a);
    }

    function executeFor(Safe account, address to, bytes memory data, bool reject)
        internal
        returns (bool)
    {
        bytes memory signatures = safeSignaturesFor(account, 201, 202, to, data);
        if (reject) {
            vm.expectRevert();
        }
        return account.execTransaction(
            to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signatures
        );
    }

    function hashFor(Safe account, address to, bytes memory data) internal view returns (bytes32) {
        uint256 nonce = account.nonce();
        return account.getTransactionHash(
            to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), address(0), nonce
        );
    }
}
