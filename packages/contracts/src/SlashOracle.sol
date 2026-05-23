// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IPhronosBond {
    function slash(uint256 erc8004Id, uint16 bps, bytes32 reasonHash) external;
}

interface IReputationRegistry {
    function submitFeedback(uint256 agentId, bool positive, string calldata reason) external;
}

/// @notice Reads 7-day rolling Sharpe ratios from the keeper and slashes
/// underperforming agents via a continuous decay schedule.
/// Also writes ERC-8004 Reputation feedback on every evaluation.
contract SlashOracle is AccessControl, Pausable {
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IPhronosBond          public immutable bond;
    IReputationRegistry   public immutable reputation;

    // Slash schedule constants (PRD §8.5)
    int256  public constant SHARPE_THRESHOLD           = 0;
    uint16  public constant MAX_SLASH_PER_EVAL_BPS     = 2500;   // 25%
    uint256 public constant EVAL_COOLDOWN              = 6 hours;
    int256  private constant DECAY_COEFF_BPS_PER_UNIT  = 5000;   // 5000 bps per unit Sharpe
    int256  private constant SCALE                     = 1e18;

    struct SharpeRecord {
        int256  value;       // scaled 1e18
        uint256 updatedAt;
        uint256 lastEvalAt;
    }

    mapping(uint256 => SharpeRecord) private _records;

    event SharpeUpdated(uint256 indexed erc8004Id, int256 rollingSharpe7dWad, uint64 updatedAt);
    event SlashEvaluated(uint256 indexed erc8004Id, uint16 bpsSlashed, int256 sharpeAtEval);
    event EvaluationSkipped(uint256 indexed erc8004Id, bytes32 reason);

    error SharpeNotSet(uint256 erc8004Id);
    error CooldownActive(uint256 erc8004Id, uint256 nextEvalAt);

    constructor(address _bond, address _reputation) {
        bond       = IPhronosBond(_bond);
        reputation = IReputationRegistry(_reputation);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(KEEPER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    function setSharpe(uint256 erc8004Id, int256 rollingSharpe7dWad) external onlyRole(KEEPER_ROLE) {
        _records[erc8004Id].value     = rollingSharpe7dWad;
        _records[erc8004Id].updatedAt = block.timestamp;
        emit SharpeUpdated(erc8004Id, rollingSharpe7dWad, uint64(block.timestamp));
    }

    function evaluateAndSlash(uint256 erc8004Id) external whenNotPaused returns (uint16 bpsSlashed) {
        SharpeRecord storage rec = _records[erc8004Id];
        if (rec.updatedAt == 0) revert SharpeNotSet(erc8004Id);
        if (rec.lastEvalAt > 0 && block.timestamp < rec.lastEvalAt + EVAL_COOLDOWN) {
            revert CooldownActive(erc8004Id, rec.lastEvalAt + EVAL_COOLDOWN);
        }

        rec.lastEvalAt = block.timestamp;

        if (rec.value >= SHARPE_THRESHOLD) {
            emit EvaluationSkipped(erc8004Id, keccak256("SHARPE_POSITIVE"));
            // Write positive reputation feedback
            try reputation.submitFeedback(erc8004Id, true, "sharpe_positive") {} catch {}
            return 0;
        }

        // bps = min(2500, abs(sharpe) * 5000 / 1e18)
        uint256 absSharpe = uint256(-rec.value);
        uint256 computed  = absSharpe * uint256(DECAY_COEFF_BPS_PER_UNIT) / uint256(SCALE);
        bpsSlashed = uint16(computed > MAX_SLASH_PER_EVAL_BPS ? MAX_SLASH_PER_EVAL_BPS : computed);

        if (bpsSlashed == 0) return 0;

        bytes32 reasonHash = keccak256(abi.encode(rec.value, block.timestamp));
        bond.slash(erc8004Id, bpsSlashed, reasonHash);

        // Write negative reputation feedback proportional to slash severity
        string memory reason = string(abi.encodePacked("slashed_", _uint2str(bpsSlashed), "bps"));
        try reputation.submitFeedback(erc8004Id, false, reason) {} catch {}

        emit SlashEvaluated(erc8004Id, bpsSlashed, rec.value);
    }

    function sharpeOf(uint256 erc8004Id) external view returns (int256 sharpe, uint64 updatedAt) {
        SharpeRecord storage rec = _records[erc8004Id];
        return (rec.value, uint64(rec.updatedAt));
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function _uint2str(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 tmp = v;
        uint256 digits;
        while (tmp != 0) { digits++; tmp /= 10; }
        bytes memory buf = new bytes(digits);
        while (v != 0) { digits--; buf[digits] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(buf);
    }
}
