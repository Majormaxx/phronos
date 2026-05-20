// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IVaultSlash {
    function slash(uint256 agentId, uint16 bps, bytes32 reasonHash) external;
}

/// @notice Reads Sharpe ratios from the Keeper and slashes underperforming agents.
contract SlashOracle is AccessControl, Pausable {
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    IVaultSlash public immutable vault;

    int256 public constant SHARPE_THRESHOLD = 0;
    uint16 public constant MAX_SLASH_BPS = 2500; // 25%
    uint256 public constant EVAL_COOLDOWN = 6 hours;
    int256 private constant SCALE = 1e18;

    struct SharpeRecord {
        int256 value; // scaled 1e18
        uint256 updatedAt;
        uint256 lastEvalAt;
    }

    mapping(uint256 => SharpeRecord) private _records;

    event SharpeSet(uint256 indexed agentId, int256 sharpe);
    event EvaluationSkipped(uint256 indexed agentId);

    error SharpeNotSet(uint256 agentId);
    error CooldownActive(uint256 agentId, uint256 nextEvalAt);

    constructor(address vaultAddress) {
        vault = IVaultSlash(vaultAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function setSharpe(uint256 agentId, int256 rollingSharpe7d) external onlyRole(KEEPER_ROLE) {
        _records[agentId].value = rollingSharpe7d;
        _records[agentId].updatedAt = block.timestamp;
        emit SharpeSet(agentId, rollingSharpe7d);
    }

    function evaluateAndSlash(uint256 agentId) external whenNotPaused returns (uint16 bpsSlashed) {
        SharpeRecord storage rec = _records[agentId];

        if (rec.updatedAt == 0) revert SharpeNotSet(agentId);
        // lastEvalAt == 0 means never evaluated — skip cooldown on first call
        if (rec.lastEvalAt > 0 && block.timestamp < rec.lastEvalAt + EVAL_COOLDOWN) {
            revert CooldownActive(agentId, rec.lastEvalAt + EVAL_COOLDOWN);
        }

        rec.lastEvalAt = block.timestamp;

        if (rec.value >= SHARPE_THRESHOLD) {
            emit EvaluationSkipped(agentId);
            return 0;
        }

        // bps = min(2500, abs(sharpe) * 5000 / 1e18)
        // -0.5 Sharpe → 2500 bps (25% — capped)
        uint256 absSharpe = uint256(-rec.value);
        uint256 computed = absSharpe * 5000 / uint256(SCALE);
        bpsSlashed = uint16(computed > MAX_SLASH_BPS ? MAX_SLASH_BPS : computed);

        if (bpsSlashed == 0) return 0;

        bytes32 reasonHash = keccak256(abi.encode(rec.value, block.timestamp));
        vault.slash(agentId, bpsSlashed, reasonHash);
    }

    function getSharpe(uint256 agentId) external view returns (int256 sharpe, uint256 updatedAt) {
        SharpeRecord storage rec = _records[agentId];
        return (rec.value, rec.updatedAt);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
