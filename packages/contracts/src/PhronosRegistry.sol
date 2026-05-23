// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IIdentityRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice Phronos-specific wrapper over ERC-8004 Identity Registry.
/// Stores strategy spec CID, active-since timestamp, and operator per agent.
/// An agent must own its ERC-8004 token to register here.
contract PhronosRegistry is AccessControl, Pausable {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IIdentityRegistry public immutable identity;

    struct AgentInfo {
        uint256 erc8004Id;
        address operator;
        string  agentCardCID;
        string  strategySpecCID;
        uint64  activeSince;
        bool    suspended;
    }

    mapping(uint256 => AgentInfo) private _agents;
    uint256[] private _agentIds;
    uint256 private _agentCount;

    event AgentRegistered(uint256 indexed erc8004Id, address indexed operator, string agentCardCID);
    event StrategySpecUpdated(uint256 indexed erc8004Id, string oldCID, string newCID);
    event AgentSuspended(uint256 indexed erc8004Id, bytes32 reasonHash);
    event AgentReinstated(uint256 indexed erc8004Id);

    error AgentAlreadyRegistered(uint256 erc8004Id);
    error UnauthorizedOperator(uint256 erc8004Id);
    error InvalidERC8004Id(uint256 erc8004Id);
    error AgentNotRegistered(uint256 erc8004Id);

    constructor(address identityRegistry) {
        identity = IIdentityRegistry(identityRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    /// @notice Register a Phronos agent. Caller must own the ERC-8004 token.
    function register(
        uint256 erc8004Id,
        string calldata agentCardCID,
        string calldata strategySpecCID
    ) external whenNotPaused {
        // Verify caller owns the ERC-8004 token
        try identity.ownerOf(erc8004Id) returns (address owner) {
            if (owner != msg.sender) revert UnauthorizedOperator(erc8004Id);
        } catch {
            revert InvalidERC8004Id(erc8004Id);
        }
        if (_agents[erc8004Id].activeSince != 0) revert AgentAlreadyRegistered(erc8004Id);

        _agents[erc8004Id] = AgentInfo({
            erc8004Id:      erc8004Id,
            operator:       msg.sender,
            agentCardCID:   agentCardCID,
            strategySpecCID: strategySpecCID,
            activeSince:    uint64(block.timestamp),
            suspended:      false
        });
        _agentIds.push(erc8004Id);
        _agentCount++;

        emit AgentRegistered(erc8004Id, msg.sender, agentCardCID);
    }

    function updateStrategySpec(uint256 erc8004Id, string calldata newCID) external {
        AgentInfo storage a = _agents[erc8004Id];
        if (a.activeSince == 0) revert AgentNotRegistered(erc8004Id);
        if (a.operator != msg.sender) revert UnauthorizedOperator(erc8004Id);
        emit StrategySpecUpdated(erc8004Id, a.strategySpecCID, newCID);
        a.strategySpecCID = newCID;
    }

    function suspend(uint256 erc8004Id, bytes32 reasonHash) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_agents[erc8004Id].activeSince == 0) revert AgentNotRegistered(erc8004Id);
        _agents[erc8004Id].suspended = true;
        emit AgentSuspended(erc8004Id, reasonHash);
    }

    function reinstate(uint256 erc8004Id) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_agents[erc8004Id].activeSince == 0) revert AgentNotRegistered(erc8004Id);
        _agents[erc8004Id].suspended = false;
        emit AgentReinstated(erc8004Id);
    }

    function agentInfo(uint256 erc8004Id) external view returns (
        uint256 erc8004Id_,
        address operator,
        string memory agentCardCID,
        string memory strategySpecCID,
        uint64 activeSince,
        bool suspended
    ) {
        AgentInfo storage a = _agents[erc8004Id];
        return (a.erc8004Id, a.operator, a.agentCardCID, a.strategySpecCID, a.activeSince, a.suspended);
    }

    function isActive(uint256 erc8004Id) external view returns (bool) {
        AgentInfo storage a = _agents[erc8004Id];
        return a.activeSince != 0 && !a.suspended;
    }

    function allAgentIds() external view returns (uint256[] memory) {
        return _agentIds;
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }
}
