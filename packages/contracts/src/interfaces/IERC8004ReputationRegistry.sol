// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Minimal interface for the ERC-8004 ReputationRegistry deployed on Arc Testnet.
// Address: 0x8004B663056A597Dffe9eCcC1965A193B7388713
// Verify exact signatures on Day 1 against the deployed ABI.
interface IERC8004ReputationRegistry {
    function submitFeedback(uint256 agentId, bool positive, string calldata reason) external;

    function positiveFeedbackCount(uint256 agentId) external view returns (uint256);

    function negativeFeedbackCount(uint256 agentId) external view returns (uint256);
}
