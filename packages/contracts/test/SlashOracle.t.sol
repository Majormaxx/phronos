// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SlashOracle} from "../src/SlashOracle.sol";

contract MockBondSlash {
    struct SlashCall { uint256 erc8004Id; uint16 bps; bytes32 reasonHash; }
    SlashCall[] public calls;
    function slash(uint256 erc8004Id, uint16 bps, bytes32 reasonHash) external {
        calls.push(SlashCall(erc8004Id, bps, reasonHash));
    }
    function callCount() external view returns (uint256) { return calls.length; }
}

contract MockReputation {
    struct FeedbackCall { uint256 agentId; bool positive; string reason; }
    FeedbackCall[] public calls;
    function submitFeedback(uint256 agentId, bool positive, string calldata reason) external {
        calls.push(FeedbackCall(agentId, positive, reason));
    }
    function callCount() external view returns (uint256) { return calls.length; }
}

contract SlashOracleTest is Test {
    SlashOracle    internal oracle;
    MockBondSlash  internal bond;
    MockReputation internal reputation;

    address internal keeper = address(0xBEEF);

    function setUp() public {
        bond       = new MockBondSlash();
        reputation = new MockReputation();
        oracle     = new SlashOracle(address(bond), address(reputation));
        oracle.grantRole(oracle.KEEPER_ROLE(), keeper);
    }

    function test_setSharpe() public {
        vm.prank(keeper);
        oracle.setSharpe(1, -5e17);
        (int256 sharpe, uint64 updatedAt) = oracle.sharpeOf(1);
        assertEq(sharpe, -5e17);
        assertEq(updatedAt, uint64(block.timestamp));
    }

    function test_setSharpe_revert_notKeeper() public {
        // Constructor grants KEEPER_ROLE to deployer (address(this)). Revoke it first
        // so the call from address(this) is actually from a non-keeper.
        oracle.revokeRole(oracle.KEEPER_ROLE(), address(this));
        vm.expectRevert();
        oracle.setSharpe(1, -5e17);
    }

    function test_evaluateAndSlash_positiveSharpe_skips() public {
        vm.prank(keeper);
        oracle.setSharpe(1, 1e18);
        uint16 bps = oracle.evaluateAndSlash(1);
        assertEq(bps, 0);
        assertEq(bond.callCount(), 0);
    }

    function test_evaluateAndSlash_negativeSharpe_slashes() public {
        vm.prank(keeper);
        oracle.setSharpe(1, -5e17); // -0.5 → 2500 bps
        uint16 bps = oracle.evaluateAndSlash(1);
        assertEq(bps, 2500);
        assertEq(bond.callCount(), 1);
        assertEq(reputation.callCount(), 1);
    }

    function test_evaluateAndSlash_smallNegative_proportional() public {
        vm.prank(keeper);
        oracle.setSharpe(1, -1e17); // -0.1 → 500 bps
        uint16 bps = oracle.evaluateAndSlash(1);
        assertEq(bps, 500);
    }

    function test_evaluateAndSlash_largeNegative_cappedAt2500() public {
        vm.prank(keeper);
        oracle.setSharpe(1, -2e18); // -2.0 → capped at 2500
        uint16 bps = oracle.evaluateAndSlash(1);
        assertEq(bps, 2500);
    }

    function test_evaluateAndSlash_revert_sharpeNotSet() public {
        vm.expectRevert(abi.encodeWithSelector(SlashOracle.SharpeNotSet.selector, 99));
        oracle.evaluateAndSlash(99);
    }

    function test_evaluateAndSlash_revert_cooldown() public {
        vm.prank(keeper);
        oracle.setSharpe(1, -5e17);
        oracle.evaluateAndSlash(1);
        vm.expectRevert();
        oracle.evaluateAndSlash(1);
    }

    function test_evaluateAndSlash_cooldownExpires() public {
        vm.prank(keeper);
        oracle.setSharpe(1, -5e17);
        oracle.evaluateAndSlash(1);
        vm.warp(block.timestamp + 6 hours + 1);
        vm.prank(keeper);
        oracle.setSharpe(1, -5e17);
        uint16 bps = oracle.evaluateAndSlash(1);
        assertEq(bps, 2500);
        assertEq(bond.callCount(), 2);
    }

    function test_pause_blocksEvaluation() public {
        vm.prank(keeper);
        oracle.setSharpe(1, -5e17);
        oracle.pause();
        vm.expectRevert();
        oracle.evaluateAndSlash(1);
    }

    function testFuzz_slashBps_neverExceedsMax(int256 sharpe) public {
        vm.assume(sharpe < 0 && sharpe > type(int128).min);
        vm.prank(keeper);
        oracle.setSharpe(1, sharpe);
        uint16 bps = oracle.evaluateAndSlash(1);
        assertLe(bps, oracle.MAX_SLASH_PER_EVAL_BPS());
    }
}
