// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract MockIdentityRegistry {
    uint256 private _nextId = 1;
    mapping(uint256 => bool) public exists_;
    mapping(uint256 => address) public operators;

    function registerAgent(address operator, string calldata) external returns (uint256 agentId) {
        agentId = _nextId++;
        exists_[agentId] = true;
        operators[agentId] = operator;
    }

    function agentExists(uint256 agentId) external view returns (bool) {
        return exists_[agentId];
    }

    function operatorOf(uint256 agentId) external view returns (address) {
        return operators[agentId];
    }
}

contract MockReputationRegistry {
    mapping(uint256 => uint256) public pos;
    mapping(uint256 => uint256) public neg;

    function submitFeedback(uint256 agentId, bool positive, string calldata) external {
        if (positive) pos[agentId]++;
        else neg[agentId]++;
    }

    function positiveFeedbackCount(uint256 agentId) external view returns (uint256) {
        return pos[agentId];
    }

    function negativeFeedbackCount(uint256 agentId) external view returns (uint256) {
        return neg[agentId];
    }
}
