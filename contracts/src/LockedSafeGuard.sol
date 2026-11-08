// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {BaseGuard} from "@safe-global/safe-contracts/contracts/base/GuardManager.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";

/// @notice Install only on an initialized 3-owner/2-threshold Safe with no modules,
/// fallback handler or setup delegatecall. Permanently disables configuration/recovery.
contract LockedSafeGuard is BaseGuard {
    function checkTransaction(
        address to,
        uint256,
        bytes memory,
        Enum.Operation operation,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes memory,
        address
    ) external view override {
        require(to != msg.sender && operation == Enum.Operation.Call, "Locked governance");
    }
    function checkAfterExecution(bytes32, bool) external pure override {}
}
