// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Mock USYC token with a Teller-compatible interface.
/// Used when the real USYC allowlist has not been granted.
/// Exchange rate: 1.0421 USDC per USYC share (hardcoded to show yield in demo).
/// Mints itself freely in exchange for USDC.
contract MockUSYC is ERC20, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    IERC20 public immutable usdc;

    // 1 USYC = 1.0421 USDC (6 decimal fixed point, scaled 1e6)
    uint256 public constant EXCHANGE_RATE_WAD = 1_042_100; // 1.0421 × 1e6

    error ZeroAmount();

    constructor(address _usdc) ERC20("Mock USYC", "mUSYC") {
        usdc = IERC20(_usdc);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    /// @notice Teller-compatible deposit.
    /// Caller must transfer USDC to this contract BEFORE calling deposit.
    /// PhronosBond does: safeTransfer(teller, amount) then teller.deposit(usdc, amount, 0).
    function deposit(address, uint256 usdcAmount, uint256) external returns (uint256 shares) {
        if (usdcAmount == 0) revert ZeroAmount();
        // USDC already sits in this contract (caller transferred before calling)
        shares = (usdcAmount * 1e18) / EXCHANGE_RATE_WAD;
        _mint(msg.sender, shares);
    }

    /// @notice Teller-compatible bulk withdraw: burns shares, returns USDC.
    function bulkWithdraw(address, uint256 shares, uint256, address recipient)
        external returns (uint256 usdcOut)
    {
        if (shares == 0) revert ZeroAmount();
        _burn(msg.sender, shares);
        usdcOut = (shares * EXCHANGE_RATE_WAD) / 1e18;
        usdc.safeTransfer(recipient, usdcOut);
    }

    /// @notice Convert USYC shares to USDC equivalent (for NAV display).
    function previewWithdraw(uint256 shares) external pure returns (uint256) {
        return (shares * EXCHANGE_RATE_WAD) / 1e18;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }
}
