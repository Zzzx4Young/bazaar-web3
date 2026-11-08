// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Non-upgradeable local/testnet token. Supply is fixed at construction.
contract BazaarTestToken is ERC20 {
    constructor(address recipient, uint256 supply) ERC20("Bazaar Test Token", "BZTEST") {
        require(recipient != address(0) && supply > 0, "Invalid initial supply");
        _mint(recipient, supply);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
