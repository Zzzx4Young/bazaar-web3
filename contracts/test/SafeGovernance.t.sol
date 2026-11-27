// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {SafeFixture, Enum} from "./SafeFixture.sol";
import {LockedSafeGuard} from "../src/LockedSafeGuard.sol";

contract ThresholdAttack {
    function lowerThreshold() external {
        (bool success,) = address(this).call(abi.encodeWithSignature("changeThreshold(uint256)", 1));
        require(success, "attack failed");
    }
}

contract GovernanceSink {
    bool public called;

    function mark() external {
        called = true;
    }
}

contract SafeGovernanceTest is SafeFixture {
    function setUp() public {
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
    }

    function testA22_actualSafeTwoSignaturesExecuteOneFails() public {
        rejectSafe(address(0x1234), "", Enum.Operation.Call, 1);
        ok(executeSafe(address(0x1234), "", Enum.Operation.Call, 2));
        eq(council.getThreshold(), 2);
        eq(council.getOwners().length, 3);
    }

    function testA22_thresholdMembersModulesGuardFallbackCannotChange() public {
        bytes[6] memory calls = [
            abi.encodeWithSignature("changeThreshold(uint256)", 1),
            abi.encodeWithSignature("addOwnerWithThreshold(address,uint256)", address(0x222), 1),
            abi.encodeWithSignature("enableModule(address)", address(this)),
            abi.encodeWithSignature("setGuard(address)", address(0)),
            abi.encodeWithSignature("setFallbackHandler(address)", address(this)),
            abi.encodeWithSignature(
                "swapOwner(address,address,address)", address(1), owners[0], address(this)
            )
        ];
        for (uint256 i; i < calls.length; i++) {
            rejectSafe(address(council), calls[i], Enum.Operation.Call, 2);
        }
        (address[] memory modules, address next) = council.getModulesPaginated(address(1), 10);
        eq(modules.length, 0);
        eq(next, address(1));
        vm.expectRevert();
        council.execTransactionFromModule(address(0x1234), 0, "", Enum.Operation.Call);
    }

    function testA22_delegatecallBatchAndRecoveryBlocked() public {
        ThresholdAttack attack = new ThresholdAttack();
        rejectSafe(
            address(attack),
            abi.encodeCall(attack.lowerThreshold, ()),
            Enum.Operation.DelegateCall,
            2
        );
        eq(council.getThreshold(), 2);
        vm.expectRevert();
        council.simulateAndRevert(address(attack), abi.encodeCall(attack.lowerThreshold, ()));
        eq(council.getThreshold(), 2);
    }
}

/// @notice Positive controls prove the blocked paths are executable on real unguarded Safe.
contract UnsafeSafeBoundaryTest is SafeFixture {
    function setUp() public {
        createSafe();
    }

    function testA22_unprotectedSafeDelegatecallReducesThresholdThenOneSignatureExecutes() public {
        ThresholdAttack attack = new ThresholdAttack();
        GovernanceSink sink = new GovernanceSink();
        ok(
            executeSafe(
                address(attack),
                abi.encodeCall(attack.lowerThreshold, ()),
                Enum.Operation.DelegateCall,
                2
            )
        );
        eq(council.getThreshold(), 1);
        ok(executeSafe(address(sink), abi.encodeCall(sink.mark, ()), Enum.Operation.Call, 1));
        ok(sink.called());
    }

    function testA22_unprotectedSafeModuleExecutesWithoutNewOwnerSignatures() public {
        GovernanceSink sink = new GovernanceSink();
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
                address(sink), 0, abi.encodeCall(sink.mark, ()), Enum.Operation.Call
            )
        );
        ok(sink.called());
    }
}
