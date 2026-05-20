// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUSYCTeller} from "./interfaces/IUSYCTeller.sol";
import {IERC8004IdentityRegistry} from "./interfaces/IERC8004IdentityRegistry.sol";
import {IERC8004ReputationRegistry} from "./interfaces/IERC8004ReputationRegistry.sol";

interface IBenchRegistry {
    function isAdmitted(uint256 agentId) external view returns (bool);
    function admittedAgents() external view returns (uint256[] memory);
}

/// @notice Core vault: holds follower deposits + trader bonds, issues shares,
///         manages USYC sleeve, pays nanopayments, slashes underperformers.
contract PhronosBondVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant ALLOCATOR_ROLE = keccak256("ALLOCATOR_ROLE");
    bytes32 public constant SENTINEL_ROLE = keccak256("SENTINEL_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");

    IERC20 public immutable USDC;
    IERC20 public immutable USYC;
    IUSYCTeller public immutable teller;
    IERC8004IdentityRegistry public immutable identity;
    IERC8004ReputationRegistry public immutable reputation;
    IBenchRegistry public immutable bench;

    uint256 public constant COOLDOWN_PERIOD = 1 days;
    uint16 public constant MAX_AGENTS = 10;

    // Follower accounting
    uint256 public totalShares;
    mapping(address => uint256) public followerShares;
    mapping(address => string) public followerGoalCid;

    // Trader accounting
    uint256[] public activeAgentIds;
    mapping(uint256 => bool) private _agentActive;
    mapping(uint256 => uint256) public traderBond;
    mapping(uint256 => uint16) public traderWeightBps;
    mapping(uint256 => uint256) public traderUnbondedAt;
    mapping(uint256 => address) public traderOperator;

    // USYC sleeve — raw USYC token balance; valued 1:1 with USDC for NAV (testnet simplification)
    uint256 public usycPosition;

    // ─── Events ───────────────────────────────────────────────────────────────
    event FollowerDeposited(address indexed user, uint256 amount, uint256 shares, string goalCid);
    event FollowerWithdrawn(address indexed user, uint256 shares, uint256 amount);
    event BondPosted(uint256 indexed agentId, address indexed operator, uint256 amount);
    event BondWithdrawn(uint256 indexed agentId, address indexed operator, uint256 amount);
    event NanopaymentPaid(uint256 indexed agentId, uint256 amount, bytes32 signalId);
    event WeightsSet(uint256[] agentIds, uint16[] weightsBps, bytes32 indexed traceHash);
    event FlippedToUSYC(uint256 usdcIn, uint256 usycOut, bytes32 indexed traceHash);
    event RedeemedFromUSYC(uint256 usycIn, uint256 usdcOut, bytes32 indexed traceHash);
    event Slashed(uint256 indexed agentId, uint16 bps, uint256 amount, bytes32 reasonHash);
    event TraceAnchored(bytes32 indexed traceHash, string ipfsCid, bytes32 indexed kind);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error ZeroAmount();
    error InsufficientShares();
    error WeightSumInvalid(uint256 got);
    error AgentNotAdmitted(uint256 agentId);
    error NotAgentOperator(uint256 agentId);
    error CooldownNotExpired(uint256 agentId);
    error MaxAgentsReached();
    error NoBondToSlash(uint256 agentId);
    error Unauthorized();

    constructor(
        address usdc,
        address usyc,
        address _teller,
        address identityRegistry,
        address reputationRegistry,
        address benchRegistry,
        address slashOracle
    ) {
        USDC = IERC20(usdc);
        USYC = IERC20(usyc);
        teller = IUSYCTeller(_teller);
        identity = IERC8004IdentityRegistry(identityRegistry);
        reputation = IERC8004ReputationRegistry(reputationRegistry);
        bench = IBenchRegistry(benchRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SLASHER_ROLE, slashOracle);
    }

    // ─── Follower side ────────────────────────────────────────────────────────

    function depositFollower(uint256 amount, string calldata goalCid)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        if (amount == 0) revert ZeroAmount();

        uint256 currentNav = nav();
        shares = (totalShares == 0 || currentNav == 0) ? amount : amount * totalShares / currentNav;

        USDC.safeTransferFrom(msg.sender, address(this), amount);
        totalShares += shares;
        followerShares[msg.sender] += shares;
        followerGoalCid[msg.sender] = goalCid;

        emit FollowerDeposited(msg.sender, amount, shares, goalCid);
    }

    function withdrawFollower(uint256 shares) external nonReentrant whenNotPaused returns (uint256 amount) {
        if (shares == 0) revert ZeroAmount();
        if (followerShares[msg.sender] < shares) revert InsufficientShares();

        amount = shares * nav() / totalShares;
        followerShares[msg.sender] -= shares;
        totalShares -= shares;

        USDC.safeTransfer(msg.sender, amount);
        emit FollowerWithdrawn(msg.sender, shares, amount);
    }

    // ─── Trader-agent side ────────────────────────────────────────────────────

    function postBond(uint256 agentId, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (!bench.isAdmitted(agentId)) revert AgentNotAdmitted(agentId);

        if (!_agentActive[agentId]) {
            if (activeAgentIds.length >= MAX_AGENTS) revert MaxAgentsReached();
            activeAgentIds.push(agentId);
            _agentActive[agentId] = true;
        }

        USDC.safeTransferFrom(msg.sender, address(this), amount);
        traderBond[agentId] += amount;
        traderOperator[agentId] = msg.sender;
        traderUnbondedAt[agentId] = block.timestamp; // lock from posting

        emit BondPosted(agentId, msg.sender, amount);
    }

    function withdrawBond(uint256 agentId) external nonReentrant returns (uint256 amount) {
        if (traderOperator[agentId] != msg.sender) revert NotAgentOperator(agentId);
        if (block.timestamp < traderUnbondedAt[agentId] + COOLDOWN_PERIOD) {
            revert CooldownNotExpired(agentId);
        }

        amount = traderBond[agentId];
        if (amount == 0) revert ZeroAmount();

        traderBond[agentId] = 0;
        traderWeightBps[agentId] = 0;
        _removeAgent(agentId);

        USDC.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(agentId, msg.sender, amount);
    }

    function payNanopayment(uint256 agentId, uint256 amount, bytes32 signalId)
        external
        nonReentrant
        onlyRole(ALLOCATOR_ROLE)
    {
        if (amount == 0) revert ZeroAmount();
        USDC.safeTransfer(traderOperator[agentId], amount);
        emit NanopaymentPaid(agentId, amount, signalId);
    }

    // ─── Allocator side ───────────────────────────────────────────────────────

    function setWeights(uint256[] calldata agentIds, uint16[] calldata weightsBps)
        external
        onlyRole(ALLOCATOR_ROLE)
    {
        _applyWeights(agentIds, weightsBps);
        emit WeightsSet(agentIds, weightsBps, bytes32(0));
    }

    /// @notice Set weights and anchor the decision trace in one call.
    function setWeightsAndAnchor(
        uint256[] calldata agentIds,
        uint16[] calldata weightsBps,
        bytes32 traceHash,
        string calldata ipfsCid
    ) external onlyRole(ALLOCATOR_ROLE) {
        _applyWeights(agentIds, weightsBps);
        emit WeightsSet(agentIds, weightsBps, traceHash);
        emit TraceAnchored(traceHash, ipfsCid, keccak256("allocation"));
    }

    // ─── Sentinel side ────────────────────────────────────────────────────────

    function flipToUSYC(uint256 amount, bytes32 traceHash, string calldata ipfsCid)
        external
        nonReentrant
        onlyRole(SENTINEL_ROLE)
    {
        if (amount == 0) revert ZeroAmount();
        USDC.approve(address(teller), amount);
        uint256 usycReceived = teller.deposit(address(USDC), amount, 0);
        usycPosition += usycReceived;
        emit FlippedToUSYC(amount, usycReceived, traceHash);
        if (traceHash != bytes32(0)) emit TraceAnchored(traceHash, ipfsCid, keccak256("regime"));
    }

    function redeemFromUSYC(uint256 usycAmount, bytes32 traceHash, string calldata ipfsCid)
        external
        nonReentrant
        onlyRole(SENTINEL_ROLE)
    {
        if (usycAmount == 0) revert ZeroAmount();
        USYC.approve(address(teller), usycAmount);
        uint256 usdcReceived = teller.bulkWithdraw(address(USDC), usycAmount, 0, address(this));
        usycPosition -= usycAmount;
        emit RedeemedFromUSYC(usycAmount, usdcReceived, traceHash);
        if (traceHash != bytes32(0)) emit TraceAnchored(traceHash, ipfsCid, keccak256("regime"));
    }

    // ─── Slash side ───────────────────────────────────────────────────────────

    function slash(uint256 agentId, uint16 bps, bytes32 reasonHash)
        external
        nonReentrant
        onlyRole(SLASHER_ROLE)
    {
        uint256 bond = traderBond[agentId];
        if (bond == 0) revert NoBondToSlash(agentId);

        uint256 slashAmount = bond * bps / 10_000;
        traderBond[agentId] -= slashAmount;
        traderUnbondedAt[agentId] = block.timestamp; // reset cooldown on slash

        // slashAmount stays in vault — increases follower pool NAV automatically
        emit Slashed(agentId, bps, slashAmount, reasonHash);
    }

    // ─── Trace anchor ─────────────────────────────────────────────────────────

    function anchorTrace(bytes32 traceHash, string calldata ipfsCid, bytes32 kind) external {
        if (!hasRole(ALLOCATOR_ROLE, msg.sender) && !hasRole(SENTINEL_ROLE, msg.sender)) {
            revert Unauthorized();
        }
        emit TraceAnchored(traceHash, ipfsCid, kind);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Follower-attributable USDC: total balance minus all trader bonds.
    function totalAssetsUSDC() public view returns (uint256) {
        uint256 totalBonds;
        for (uint256 i; i < activeAgentIds.length; ++i) {
            totalBonds += traderBond[activeAgentIds[i]];
        }
        uint256 bal = USDC.balanceOf(address(this));
        return bal > totalBonds ? bal - totalBonds : 0;
    }

    function totalUSYC() public view returns (uint256) {
        return usycPosition;
    }

    /// @notice NAV in USDC terms. USYC valued 1:1 (testnet — no oracle needed).
    function nav() public view returns (uint256) {
        return totalAssetsUSDC() + usycPosition / 1e12; // 18→6 decimals
    }

    function getActiveAgents() external view returns (uint256[] memory) {
        return activeAgentIds;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _applyWeights(uint256[] calldata agentIds, uint16[] calldata weightsBps) internal {
        uint256 sum;
        for (uint256 i; i < weightsBps.length; ++i) {
            sum += weightsBps[i];
        }
        if (sum != 10_000) revert WeightSumInvalid(sum);

        for (uint256 i; i < activeAgentIds.length; ++i) {
            traderWeightBps[activeAgentIds[i]] = 0;
        }
        for (uint256 i; i < agentIds.length; ++i) {
            traderWeightBps[agentIds[i]] = weightsBps[i];
        }
    }

    function _removeAgent(uint256 agentId) internal {
        if (!_agentActive[agentId]) return;
        uint256 len = activeAgentIds.length;
        for (uint256 i; i < len; ++i) {
            if (activeAgentIds[i] == agentId) {
                activeAgentIds[i] = activeAgentIds[len - 1];
                activeAgentIds.pop();
                break;
            }
        }
        _agentActive[agentId] = false;
    }
}
