// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IAgenticCommerce} from "./interfaces/IAgenticCommerce.sol";

interface IPhronosRegistry {
    function isActive(uint256 erc8004Id) external view returns (bool);
    function agentInfo(uint256 erc8004Id) external view returns (
        uint256, address operator, string memory, string memory, uint64, bool
    );
}

interface IReputationRegistry {
    function submitFeedback(uint256 agentId, bool positive, string calldata reason) external;
}

/// @notice Core router: follower escrow, signed intents, copy execution, refusal events.
/// Integrates ERC-8183 AgenticCommerce for on-chain job audit trail and
/// ERC-8004 Reputation Registry for agent score writes on every copy/refusal.
contract PhronosRouter is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    bytes32 public constant VENUE_ROLE  = keccak256("VENUE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // EIP-712 domain separator
    bytes32 private immutable _DOMAIN_SEPARATOR;
    bytes32 private constant INTENT_TYPEHASH = keccak256(
        "Intent(uint256 erc8004Id,uint8 venue,bytes32 marketId,int256 notionalUSDC,"
        "uint64 validUntil,uint256 nonce,bytes32 strategyHash,bytes32 traceCID)"
    );

    enum Venue { ARC_USDC_SWAP, HYPERLIQUID_PERP, POLYMARKET_PRED }
    enum RefusalReason { NONE, LLM_JUDGMENT, MACRO_SHIFT, WHALE_CONTRADICTION, POLICY_VIOLATION }

    struct Intent {
        uint256 erc8004Id;
        Venue   venue;
        bytes32 marketId;
        int256  notionalUSDC;
        uint64  validUntil;
        uint256 nonce;
        bytes32 strategyHash;
        bytes32 traceCID;
    }

    IERC20              public immutable usdc;
    IPhronosRegistry    public immutable registry;

    // ERC-8183 job factory — each copy creates an on-chain job receipt.
    // admin-settable; address(0) disables ERC-8183 integration gracefully.
    IAgenticCommerce    public jobFactory;

    // ERC-8004 reputation registry — copy writes positive, refusal writes negative.
    // admin-settable; address(0) disables rep writes gracefully.
    IReputationRegistry public reputationRegistry;

    mapping(address => uint256) public escrowOf;
    mapping(address => mapping(uint256 => bool))    public copyActive;    // follower => agentId => active
    mapping(address => mapping(uint256 => uint256)) public activeJobId;   // follower => agentId => ERC-8183 jobId
    mapping(uint256 => uint256) public feesAccrued;                       // agentId => USDC fees
    mapping(bytes32 => bool)    private _processedIntents;
    mapping(uint256 => uint256) private _agentNonces;

    uint256 public slashPool;

    event Deposited(address indexed follower, uint256 usdcAmount);
    event Withdrew(address indexed follower, uint256 usdcAmount);
    event SlashReceived(uint256 amount);
    event CopyActivated(address indexed follower, uint256 indexed erc8004Id, uint256 jobId);
    event CopyRevoked(address indexed follower, uint256 indexed erc8004Id);
    event IntentSubmitted(uint256 indexed erc8004Id, bytes32 indexed intentHash, uint8 venue, int256 notionalUSDC, bytes32 traceCID);
    event Copied(address indexed follower, uint256 indexed erc8004Id, bytes32 indexed intentHash, int256 followerNotional, bytes32 venueReceiptHash);
    event Refused(address indexed follower, uint256 indexed erc8004Id, bytes32 indexed intentHash, uint8 reason, bytes32 reasonCID);
    event BuilderFeeCaptured(uint256 indexed erc8004Id, bytes32 indexed intentHash, uint256 feeUSDC, uint8 venue);
    event FeesWithdrawn(uint256 indexed erc8004Id, address indexed operator, uint256 amount);
    event JobFactorySet(address indexed factory);
    event ReputationRegistrySet(address indexed registry);

    error InvalidSignature();
    error IntentExpired();
    error IntentAlreadyProcessed();
    error InsufficientEscrow();
    error AgentSuspended(uint256 erc8004Id);
    error ZeroAmount();
    error StaleNonce();

    constructor(address _usdc, address _registry) {
        usdc     = IERC20(_usdc);
        registry = IPhronosRegistry(_registry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VENUE_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);

        _DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Phronos Router"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    // ─── Admin configuration ──────────────────────────────────────────────────

    function setJobFactory(address factory) external onlyRole(DEFAULT_ADMIN_ROLE) {
        jobFactory = IAgenticCommerce(factory);
        emit JobFactorySet(factory);
    }

    function setReputationRegistry(address rep) external onlyRole(DEFAULT_ADMIN_ROLE) {
        reputationRegistry = IReputationRegistry(rep);
        emit ReputationRegistrySet(rep);
    }

    // ─── Follower side ────────────────────────────────────────────────────────

    function depositFollower(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        escrowOf[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdrawFollower(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (escrowOf[msg.sender] < amount) revert InsufficientEscrow();
        escrowOf[msg.sender] -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrew(msg.sender, amount);
    }

    /// @notice Follower activates copy subscription for an agent.
    /// Creates an ERC-8183 job (router = client & evaluator, agent = provider)
    /// to establish a verifiable on-chain subscription receipt.
    function activateCopy(uint256 erc8004Id) external {
        if (!registry.isActive(erc8004Id)) revert AgentSuspended(erc8004Id);
        copyActive[msg.sender][erc8004Id] = true;

        uint256 jobId;
        if (address(jobFactory) != address(0)) {
            (, address agentOp,,,,) = registry.agentInfo(erc8004Id);
            try jobFactory.createJob(
                agentOp,
                address(this),
                address(usdc),
                0,
                uint64(block.timestamp + 30 days)
            ) returns (uint256 id) {
                jobId = id;
                activeJobId[msg.sender][erc8004Id] = id;
            } catch {}
        }

        emit CopyActivated(msg.sender, erc8004Id, jobId);
    }

    function revokeCopy(uint256 erc8004Id) external {
        copyActive[msg.sender][erc8004Id] = false;
        emit CopyRevoked(msg.sender, erc8004Id);
    }

    // ─── Intent submission ────────────────────────────────────────────────────

    function submitIntent(Intent calldata intent, bytes calldata operatorSig) external whenNotPaused {
        if (block.timestamp > intent.validUntil) revert IntentExpired();

        bytes32 intentHash = _hashIntent(intent);
        if (_processedIntents[intentHash]) revert IntentAlreadyProcessed();

        if (intent.nonce <= _agentNonces[intent.erc8004Id] && _agentNonces[intent.erc8004Id] != 0) {
            revert StaleNonce();
        }

        (, address operator,,,,) = registry.agentInfo(intent.erc8004Id);
        address recovered = MessageHashUtils.toTypedDataHash(_DOMAIN_SEPARATOR, intentHash).recover(operatorSig);
        if (recovered != operator) revert InvalidSignature();

        _processedIntents[intentHash] = true;
        _agentNonces[intent.erc8004Id] = intent.nonce;

        emit IntentSubmitted(intent.erc8004Id, intentHash, uint8(intent.venue), intent.notionalUSDC, intent.traceCID);
    }

    // ─── Copy execution (VENUE_ROLE only) ─────────────────────────────────────

    /// @notice Record a copy execution. Completes the active ERC-8183 job and opens
    /// the next one. Writes positive ERC-8004 reputation for the agent.
    function recordCopy(
        bytes32 intentHash,
        uint256 erc8004Id,
        address follower,
        int256  followerNotional,
        bytes32 venueReceiptHash,
        uint256 feeUSDC,
        uint8   venue
    ) external onlyRole(VENUE_ROLE) {
        // ERC-8183: complete current job and create the next subscription job
        if (address(jobFactory) != address(0)) {
            uint256 jobId = activeJobId[follower][erc8004Id];
            if (jobId != 0) {
                try jobFactory.submitDeliverable(jobId, venueReceiptHash) {} catch {}
                try jobFactory.completeJob(jobId) {} catch {}
            }
            // Open next job to keep the subscription chain alive
            (, address agentOp,,,,) = registry.agentInfo(erc8004Id);
            try jobFactory.createJob(
                agentOp,
                address(this),
                address(usdc),
                0,
                uint64(block.timestamp + 30 days)
            ) returns (uint256 nextId) {
                activeJobId[follower][erc8004Id] = nextId;
            } catch {}
        }

        // ERC-8004: positive reputation — agent successfully served a copy
        if (address(reputationRegistry) != address(0)) {
            try reputationRegistry.submitFeedback(erc8004Id, true, "copy_executed") {} catch {}
        }

        emit Copied(follower, erc8004Id, intentHash, followerNotional, venueReceiptHash);
        if (feeUSDC > 0) {
            feesAccrued[erc8004Id] += feeUSDC;
            emit BuilderFeeCaptured(erc8004Id, intentHash, feeUSDC, venue);
        }
    }

    /// @notice Record a refusal. Rejects the active ERC-8183 job and writes
    /// negative ERC-8004 reputation for the agent whose intent was refused.
    function recordRefusal(
        bytes32 intentHash,
        uint256 erc8004Id,
        address follower,
        uint8   reason,
        bytes32 reasonCID
    ) external onlyRole(VENUE_ROLE) {
        // ERC-8183: reject current job (intent failed policy check)
        if (address(jobFactory) != address(0)) {
            uint256 jobId = activeJobId[follower][erc8004Id];
            if (jobId != 0) {
                try jobFactory.rejectJob(jobId) {} catch {}
            }
            // Open fresh job for next intent
            (, address agentOp,,,,) = registry.agentInfo(erc8004Id);
            try jobFactory.createJob(
                agentOp,
                address(this),
                address(usdc),
                0,
                uint64(block.timestamp + 30 days)
            ) returns (uint256 nextId) {
                activeJobId[follower][erc8004Id] = nextId;
            } catch {}
        }

        // ERC-8004: negative reputation — agent's intent failed refuser policy
        if (address(reputationRegistry) != address(0)) {
            string memory reasonStr = reason == 1 ? "refusal_llm_judgment"
                : reason == 2 ? "refusal_macro_shift"
                : reason == 3 ? "refusal_whale_contradiction"
                : "refusal_policy_violation";
            try reputationRegistry.submitFeedback(erc8004Id, false, reasonStr) {} catch {}
        }

        emit Refused(follower, erc8004Id, intentHash, reason, reasonCID);
    }

    // ─── Fee withdrawal ───────────────────────────────────────────────────────

    function withdrawFees(uint256 erc8004Id) external nonReentrant returns (uint256 amount) {
        (, address operator,,,,) = registry.agentInfo(erc8004Id);
        if (operator != msg.sender) revert InvalidSignature();
        amount = feesAccrued[erc8004Id];
        if (amount == 0) revert ZeroAmount();
        feesAccrued[erc8004Id] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit FeesWithdrawn(erc8004Id, msg.sender, amount);
    }

    // ─── Slash pool ───────────────────────────────────────────────────────────

    function receiveSlash(uint256 amount) external {
        slashPool += amount;
        emit SlashReceived(amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function domainSeparator() external view returns (bytes32) {
        return _DOMAIN_SEPARATOR;
    }

    function intentProcessed(bytes32 intentHash) external view returns (bool) {
        return _processedIntents[intentHash];
    }

    function agentNonce(uint256 erc8004Id) external view returns (uint256) {
        return _agentNonces[erc8004Id];
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _hashIntent(Intent calldata i) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            INTENT_TYPEHASH,
            i.erc8004Id,
            uint8(i.venue),
            i.marketId,
            i.notionalUSDC,
            i.validUntil,
            i.nonce,
            i.strategyHash,
            i.traceCID
        ));
    }
}
