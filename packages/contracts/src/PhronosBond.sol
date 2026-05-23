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

/// @notice Holds USDC-denominated performance bonds for Phronos agents.
/// Testnet: bonds held in raw USDC (1:1 shares). Mainnet: convert to USYC via Teller.
/// Slashed USDC is forwarded to the router's follower payout pool.
contract PhronosBond is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    bytes32 public constant PAUSER_ROLE  = keccak256("PAUSER_ROLE");

    uint256 public constant COOLDOWN_PERIOD        = 1 days;
    uint16  public constant MAX_SLASH_PER_CALL_BPS = 2500;    // 25%
    uint256 public constant MIN_BOND_USDC          = 2_000_000; // 2 USDC (testnet)

    IERC20             public immutable usdc;
    IPhronosRegistry   public immutable registry;
    address            public immutable router; // receives slashed USDC

    struct BondState {
        uint256 usdcBalance;
        uint64  unbondedAt;
        uint64  cooldownUntil;
    }

    mapping(uint256 => BondState) private _bonds;

    event BondPosted(uint256 indexed erc8004Id, address indexed operator, uint256 usdcAmount);
    event BondTopUp(uint256 indexed erc8004Id, uint256 usdcAmount);
    event BondWithdrawalRequested(uint256 indexed erc8004Id, uint64 cooldownUntil);
    event BondWithdrawn(uint256 indexed erc8004Id, address indexed operator, uint256 usdcAmount);
    event Slashed(uint256 indexed erc8004Id, uint16 bps, uint256 usdcReleased, bytes32 reasonHash);

    error InsufficientBond(uint256 erc8004Id);
    error CooldownActive(uint256 erc8004Id, uint64 cooldownUntil);
    error NotOperator(uint256 erc8004Id);
    error AgentNotActive(uint256 erc8004Id);
    error BelowMinBond();
    error MaxSlashExceeded();
    error ZeroAmount();
    error WithdrawalNotRequested(uint256 erc8004Id);

    constructor(address _usdc, address _registry, address _router) {
        usdc     = IERC20(_usdc);
        registry = IPhronosRegistry(_registry);
        router   = _router;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

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
        if (_bonds[erc8004Id].usdcBalance == 0) revert AgentNotActive(erc8004Id);

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        _bonds[erc8004Id].usdcBalance += usdcAmount;

        emit BondTopUp(erc8004Id, usdcAmount);
    }

    function requestWithdrawal(uint256 erc8004Id) external {
        (, address operator,,,,) = registry.agentInfo(erc8004Id);
        if (operator != msg.sender) revert NotOperator(erc8004Id);
        if (_bonds[erc8004Id].usdcBalance == 0) revert InsufficientBond(erc8004Id);

        uint64 cooldown = uint64(block.timestamp + COOLDOWN_PERIOD);
        _bonds[erc8004Id].unbondedAt    = uint64(block.timestamp);
        _bonds[erc8004Id].cooldownUntil = cooldown;

        emit BondWithdrawalRequested(erc8004Id, cooldown);
    }

    function withdrawBond(uint256 erc8004Id) external nonReentrant returns (uint256 amount) {
        (, address operator,,,,) = registry.agentInfo(erc8004Id);
        if (operator != msg.sender) revert NotOperator(erc8004Id);

        BondState storage b = _bonds[erc8004Id];
        if (b.cooldownUntil == 0) revert WithdrawalNotRequested(erc8004Id);
        if (block.timestamp < b.cooldownUntil) revert CooldownActive(erc8004Id, b.cooldownUntil);

        amount = b.usdcBalance;
        if (amount == 0) revert InsufficientBond(erc8004Id);

        b.usdcBalance   = 0;
        b.unbondedAt    = 0;
        b.cooldownUntil = 0;

        usdc.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(erc8004Id, msg.sender, amount);
    }

    /// @notice Slash `bps` basis points of an agent's bond. Slashed USDC → router.
    function slash(uint256 erc8004Id, uint16 bps, bytes32 reasonHash)
        external nonReentrant onlyRole(SLASHER_ROLE)
    {
        if (bps > MAX_SLASH_PER_CALL_BPS) revert MaxSlashExceeded();
        BondState storage b = _bonds[erc8004Id];
        if (b.usdcBalance == 0) revert InsufficientBond(erc8004Id);

        uint256 slashAmount = b.usdcBalance * bps / 10_000;
        if (slashAmount == 0) return;

        b.usdcBalance   -= slashAmount;
        b.cooldownUntil  = uint64(block.timestamp + COOLDOWN_PERIOD);

        usdc.safeTransfer(router, slashAmount);
        emit Slashed(erc8004Id, bps, slashAmount, reasonHash);
    }

    function bondOf(uint256 erc8004Id) external view returns (BondState memory) {
        return _bonds[erc8004Id];
    }

    function bondBalanceOf(uint256 erc8004Id) external view returns (uint256) {
        return _bonds[erc8004Id].usdcBalance;
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }
}
