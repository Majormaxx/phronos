// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IPhronosRegistry {
    function isActive(uint256 erc8004Id) external view returns (bool);
    function agentInfo(uint256 erc8004Id) external view returns (
        uint256, address operator, string memory, string memory, uint64, bool
    );
}

/// @notice USYC Teller — read-only interface used only for previewRedeem (no allowlist required).
interface IUsycTeller {
    /// @dev Returns USDC amount redeemable for `shares`. View-only; no allowlist check.
    function previewRedeem(uint256 shares) external view returns (uint256 assets);
}

/// @notice Holds yield-bearing performance bonds for Phronos agents.
///
/// Two posting paths:
///   postBond(agentId, usdcAmount)       — USDC fallback (testnet no-USYC mode)
///   postBondUsyc(agentId, usycShares)   — real path: caller pre-deposits USDC → USYC via Teller,
///                                         then approves USYC to this contract.
///
/// Slash transfers USYC shares (or USDC) directly to the router's follower NAV pool.
/// Operators withdraw USYC shares (or USDC) directly; allowlisted operators can redeem
/// USYC → USDC via the Teller themselves after withdrawal.
///
/// PhronosBond never calls Teller.deposit() or Teller.redeem() — only Teller.previewRedeem()
/// (a view function) — so PhronosBond does not need to be on the USYC allowlist.
contract PhronosBond is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    bytes32 public constant PAUSER_ROLE  = keccak256("PAUSER_ROLE");

    uint256 public constant COOLDOWN_PERIOD        = 1 days;
    uint16  public constant MAX_SLASH_PER_CALL_BPS = 2500;    // 25%
    uint256 public constant MIN_BOND_USDC          = 2_000_000; // 2 USDC (6 decimals)

    IERC20             public immutable usdc;
    IERC20             public immutable usyc;       // zero address → USDC-only mode
    IUsycTeller        public immutable teller;     // zero address → USDC-only mode
    IPhronosRegistry   public immutable registry;
    address            public immutable router;     // receives slashed tokens

    struct BondState {
        uint256 usycShares;    // non-zero when posted via postBondUsyc
        uint256 usdcBalance;   // non-zero when posted via postBond (USDC fallback)
        uint64  unbondedAt;
        uint64  cooldownUntil;
    }

    mapping(uint256 => BondState) private _bonds;

    event BondPosted(uint256 indexed erc8004Id, address indexed operator, uint256 usdcAmount);
    event BondPostedUsyc(uint256 indexed erc8004Id, address indexed operator, uint256 usycShares);
    event BondTopUp(uint256 indexed erc8004Id, uint256 usdcAmount);
    event BondTopUpUsyc(uint256 indexed erc8004Id, uint256 usycShares);
    event BondWithdrawalRequested(uint256 indexed erc8004Id, uint64 cooldownUntil);
    event BondWithdrawn(uint256 indexed erc8004Id, address indexed operator, uint256 usdcAmount);
    event BondWithdrawnUsyc(uint256 indexed erc8004Id, address indexed operator, uint256 usycShares);
    event Slashed(uint256 indexed erc8004Id, uint16 bps, uint256 usdcEquiv, bytes32 reasonHash);

    error InsufficientBond(uint256 erc8004Id);
    error CooldownActive(uint256 erc8004Id, uint64 cooldownUntil);
    error NotOperator(uint256 erc8004Id);
    error AgentNotActive(uint256 erc8004Id);
    error BelowMinBond();
    error MaxSlashExceeded();
    error ZeroAmount();
    error WithdrawalNotRequested(uint256 erc8004Id);
    error UsycNotConfigured();

    /// @param _usdc   USDC token (Arc: 0x3600...0000)
    /// @param _usyc   USYC token (Arc: 0xe918...); pass address(0) to disable USYC path
    /// @param _teller USYC Teller (Arc: 0x9fdF...); pass address(0) to disable USYC path
    constructor(
        address _usdc,
        address _usyc,
        address _teller,
        address _registry,
        address _router
    ) {
        usdc     = IERC20(_usdc);
        usyc     = IERC20(_usyc);
        teller   = IUsycTeller(_teller);
        registry = IPhronosRegistry(_registry);
        router   = _router;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    // ── USDC path (fallback) ─────────────────────────────────────────────────

    function postBond(uint256 erc8004Id, uint256 usdcAmount) external nonReentrant whenNotPaused {
        if (usdcAmount < MIN_BOND_USDC) revert BelowMinBond();
        if (!registry.isActive(erc8004Id)) revert AgentNotActive(erc8004Id);

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        BondState storage b = _bonds[erc8004Id];
        b.usdcBalance  += usdcAmount;
        b.unbondedAt    = 0;
        b.cooldownUntil = 0;

        emit BondPosted(erc8004Id, msg.sender, usdcAmount);
    }

    function topUpBond(uint256 erc8004Id, uint256 usdcAmount) external nonReentrant whenNotPaused {
        if (usdcAmount == 0) revert ZeroAmount();
        if (_bonds[erc8004Id].usdcBalance == 0) revert InsufficientBond(erc8004Id);

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        _bonds[erc8004Id].usdcBalance += usdcAmount;

        emit BondTopUp(erc8004Id, usdcAmount);
    }

    // ── USYC path (real yield-bearing bonds) ────────────────────────────────

    /// @notice Post a bond using USYC shares already held by the caller.
    ///
    /// Caller flow (allowlisted operator only):
    ///   1. USDC.approve(teller, amount)
    ///   2. Teller.deposit(amount, callerAddress)   → caller receives USYC shares
    ///   3. USYC.approve(bondAddress, shares)
    ///   4. bond.postBondUsyc(agentId, shares)      → bond holds yield-bearing USYC
    function postBondUsyc(uint256 erc8004Id, uint256 usycShares) external nonReentrant whenNotPaused {
        if (address(usyc) == address(0)) revert UsycNotConfigured();
        if (usycShares == 0) revert ZeroAmount();
        if (!registry.isActive(erc8004Id)) revert AgentNotActive(erc8004Id);

        // Verify minimum bond in USDC-equivalent
        uint256 usdcEquiv = address(teller) != address(0)
            ? teller.previewRedeem(usycShares)
            : usycShares; // 1:1 fallback if no teller configured
        if (usdcEquiv < MIN_BOND_USDC) revert BelowMinBond();

        usyc.safeTransferFrom(msg.sender, address(this), usycShares);

        BondState storage b = _bonds[erc8004Id];
        b.usycShares   += usycShares;
        b.unbondedAt    = 0;
        b.cooldownUntil = 0;

        emit BondPostedUsyc(erc8004Id, msg.sender, usycShares);
    }

    function topUpBondUsyc(uint256 erc8004Id, uint256 usycShares) external nonReentrant whenNotPaused {
        if (address(usyc) == address(0)) revert UsycNotConfigured();
        if (usycShares == 0) revert ZeroAmount();
        if (_bonds[erc8004Id].usycShares == 0) revert InsufficientBond(erc8004Id);

        usyc.safeTransferFrom(msg.sender, address(this), usycShares);
        _bonds[erc8004Id].usycShares += usycShares;

        emit BondTopUpUsyc(erc8004Id, usycShares);
    }

    // ── Withdrawal ───────────────────────────────────────────────────────────

    function requestWithdrawal(uint256 erc8004Id) external {
        (, address operator,,,,) = registry.agentInfo(erc8004Id);
        if (operator != msg.sender) revert NotOperator(erc8004Id);

        BondState storage b = _bonds[erc8004Id];
        if (b.usdcBalance == 0 && b.usycShares == 0) revert InsufficientBond(erc8004Id);

        uint64 cooldown = uint64(block.timestamp + COOLDOWN_PERIOD);
        b.unbondedAt    = uint64(block.timestamp);
        b.cooldownUntil = cooldown;

        emit BondWithdrawalRequested(erc8004Id, cooldown);
    }

    function withdrawBond(uint256 erc8004Id) external nonReentrant returns (uint256 amount) {
        (, address operator,,,,) = registry.agentInfo(erc8004Id);
        if (operator != msg.sender) revert NotOperator(erc8004Id);

        BondState storage b = _bonds[erc8004Id];
        if (b.cooldownUntil == 0) revert WithdrawalNotRequested(erc8004Id);
        if (block.timestamp < b.cooldownUntil) revert CooldownActive(erc8004Id, b.cooldownUntil);

        b.unbondedAt    = 0;
        b.cooldownUntil = 0;

        if (b.usycShares > 0) {
            uint256 shares = b.usycShares;
            b.usycShares   = 0;
            usyc.safeTransfer(msg.sender, shares);
            emit BondWithdrawnUsyc(erc8004Id, msg.sender, shares);
            // Operator (allowlisted) can now call Teller.redeem(shares, operator, operator) themselves.
            return address(teller) != address(0) ? teller.previewRedeem(shares) : shares;
        } else {
            amount = b.usdcBalance;
            if (amount == 0) revert InsufficientBond(erc8004Id);
            b.usdcBalance = 0;
            usdc.safeTransfer(msg.sender, amount);
            emit BondWithdrawn(erc8004Id, msg.sender, amount);
        }
    }

    // ── Slash ────────────────────────────────────────────────────────────────

    /// @notice Slash `bps` basis points of an agent's bond. Slashed tokens → router.
    /// USYC path: transfers USYC shares directly (router accumulates for follower NAV pool).
    /// USDC path: transfers USDC (unchanged from v1).
    function slash(uint256 erc8004Id, uint16 bps, bytes32 reasonHash)
        external nonReentrant onlyRole(SLASHER_ROLE)
    {
        if (bps > MAX_SLASH_PER_CALL_BPS) revert MaxSlashExceeded();

        BondState storage b = _bonds[erc8004Id];

        if (b.usycShares > 0) {
            uint256 sharesToSlash = b.usycShares * bps / 10_000;
            if (sharesToSlash == 0) return;

            b.usycShares   -= sharesToSlash;
            b.cooldownUntil = uint64(block.timestamp + COOLDOWN_PERIOD);

            usyc.safeTransfer(router, sharesToSlash);

            uint256 usdcEquiv = address(teller) != address(0)
                ? teller.previewRedeem(sharesToSlash)
                : sharesToSlash;
            emit Slashed(erc8004Id, bps, usdcEquiv, reasonHash);
        } else if (b.usdcBalance > 0) {
            uint256 slashAmount = b.usdcBalance * bps / 10_000;
            if (slashAmount == 0) return;

            b.usdcBalance   -= slashAmount;
            b.cooldownUntil  = uint64(block.timestamp + COOLDOWN_PERIOD);

            usdc.safeTransfer(router, slashAmount);
            emit Slashed(erc8004Id, bps, slashAmount, reasonHash);
        } else {
            revert InsufficientBond(erc8004Id);
        }
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function bondOf(uint256 erc8004Id) external view returns (BondState memory) {
        return _bonds[erc8004Id];
    }

    /// @notice Returns the USDC-equivalent value of an agent's bond.
    /// For USYC bonds: uses Teller.previewRedeem (view-only, no allowlist check).
    /// For USDC bonds: returns raw balance.
    function bondBalanceOf(uint256 erc8004Id) external view returns (uint256) {
        BondState storage b = _bonds[erc8004Id];
        if (b.usycShares > 0 && address(teller) != address(0)) {
            return teller.previewRedeem(b.usycShares);
        }
        return b.usdcBalance;
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }
}
