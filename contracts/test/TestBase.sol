// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface Vm {
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function prank(address) external;
    function prank(address, address) external;
    function startPrank(address, address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function chainId(uint256) external;
    function expectRevert() external;
    function expectRevert(bytes calldata) external;
    function etch(address, bytes calldata) external;
    function readFile(string calldata) external returns (string memory);
    function parseJson(string calldata, string calldata) external returns (bytes memory);
    function parseJsonAddress(string calldata, string calldata) external returns (address);
    function parseJsonBytes32(string calldata, string calldata) external returns (bytes32);
    function parseJsonUint(string calldata, string calldata) external returns (uint256);
    function parseJsonBytes(string calldata, string calldata) external returns (bytes memory);
    function targetContract(address) external;
    function writeFile(string calldata, string calldata) external;
    function toString(address) external returns (string memory);
}

contract TestBase {
    event log_named_uint(string key, uint256 value);
    event log_named_bytes32(string key, bytes32 value);
    event log_named_address(string key, address value);
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function eq(uint256 a, uint256 b) internal pure {
        require(a == b, "uint mismatch");
    }

    function eq(bytes32 a, bytes32 b) internal pure {
        require(a == b, "hash mismatch");
    }

    function eq(address a, address b) internal pure {
        require(a == b, "address mismatch");
    }

    function ok(bool a) internal pure {
        require(a, "false assertion");
    }

    function sig(uint256 key, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
