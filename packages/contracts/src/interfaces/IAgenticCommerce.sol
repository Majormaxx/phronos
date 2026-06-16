// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice ERC-8183 AgenticCommerce — on-chain job lifecycle for agent work.
/// Arc Testnet factory: 0x0747EEf0706327138c69792bF28Cd525089e4583
interface IAgenticCommerce {
    enum JobStatus { Open, Funded, Submitted, Completed, Rejected, Expired }

    function createJob(
        address provider,
        address evaluator,
        address paymentToken,
        uint256 paymentAmount,
        uint64  deadline
    ) external returns (uint256 jobId);

    function fundJob(uint256 jobId) external;
    function submitDeliverable(uint256 jobId, bytes32 deliverableHash) external;
    function completeJob(uint256 jobId) external;
    function rejectJob(uint256 jobId) external;
    function expireJob(uint256 jobId) external;

    function getJob(uint256 jobId) external view returns (
        address client,
        address provider,
        address evaluator,
        address paymentToken,
        uint256 paymentAmount,
        uint64  deadline,
        JobStatus status,
        bytes32 deliverableHash
    );
}
