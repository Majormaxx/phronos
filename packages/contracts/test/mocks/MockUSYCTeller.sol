// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MockERC20} from "./MockERC20.sol";

/// @dev 1:1 teller: 1e6 USDC in → 1e18 USYC out (handles the decimal difference).
contract MockUSYCTeller {
    MockERC20 public usdc;
    MockERC20 public usyc;

    constructor(address _usdc, address _usyc) {
        usdc = MockERC20(_usdc);
        usyc = MockERC20(_usyc);
    }

    function deposit(address, uint256 depositAmount, uint256) external returns (uint256 shares) {
        usdc.transferFrom(msg.sender, address(this), depositAmount);
        shares = depositAmount * 1e12; // 6 → 18 decimals, 1:1 USD value
        usyc.mint(msg.sender, shares);
    }

    function bulkWithdraw(address, uint256 shareAmount, uint256, address to)
        external
        returns (uint256 assetsOut)
    {
        usyc.transferFrom(msg.sender, address(this), shareAmount);
        assetsOut = shareAmount / 1e12; // 18 → 6 decimals
        usdc.mint(to, assetsOut);
    }
}
