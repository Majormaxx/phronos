// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC8004IdentityRegistry} from "./interfaces/IERC8004IdentityRegistry.sol";

/// @notice Whitelist of ERC-8004 agent IDs eligible to sit on the Phronos bench.
contract BenchRegistry is AccessControl, Pausable {
    IERC8004IdentityRegistry public immutable identity;

    mapping(uint256 => bool) private _admitted;
    uint256[] private _bench;
    mapping(uint256 => uint256) private _benchIndex; // agentId → 1-indexed position in _bench

    event AgentAdmitted(uint256 indexed agentId);
    event AgentExpelled(uint256 indexed agentId);

    error AgentNotRegistered(uint256 agentId);
    error AgentAlreadyAdmitted(uint256 agentId);
    error AgentNotAdmitted(uint256 agentId);

    constructor(address identityRegistry) {
        identity = IERC8004IdentityRegistry(identityRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function admit(uint256 agentId) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        if (!identity.agentExists(agentId)) revert AgentNotRegistered(agentId);
        if (_admitted[agentId]) revert AgentAlreadyAdmitted(agentId);

        _admitted[agentId] = true;
        _bench.push(agentId);
        _benchIndex[agentId] = _bench.length; // 1-indexed

        emit AgentAdmitted(agentId);
    }

    function expel(uint256 agentId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_admitted[agentId]) revert AgentNotAdmitted(agentId);

        uint256 idx = _benchIndex[agentId] - 1; // 0-indexed
        uint256 last = _bench[_bench.length - 1];
        _bench[idx] = last;
        _benchIndex[last] = idx + 1; // 1-indexed
        _bench.pop();

        delete _admitted[agentId];
        delete _benchIndex[agentId];

        emit AgentExpelled(agentId);
    }

    function isAdmitted(uint256 agentId) external view returns (bool) {
        return _admitted[agentId];
    }

    function admittedAgents() external view returns (uint256[] memory) {
        return _bench;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
