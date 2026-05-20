// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Minimal interface for the ERC-8004 IdentityRegistry deployed on Arc Testnet.
// Address: 0x8004A818BFB912233c491871b3d84c89A494BD9e
// Verify exact signatures on Day 1 against the deployed ABI.
interface IERC8004IdentityRegistry {
    function registerAgent(address operator, string calldata agentCardCid) external returns (uint256 agentId);

    function agentExists(uint256 agentId) external view returns (bool);

    function operatorOf(uint256 agentId) external view returns (address);
}
