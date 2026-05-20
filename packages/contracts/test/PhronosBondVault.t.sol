// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PhronosBondVault} from "../src/PhronosBondVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockUSYCTeller} from "./mocks/MockUSYCTeller.sol";
import {MockIdentityRegistry, MockReputationRegistry} from "./mocks/MockERC8004.sol";

contract MockBenchRegistry {
    mapping(uint256 => bool) public admitted;

    function setAdmitted(uint256 id, bool val) external {
        admitted[id] = val;
    }

    function isAdmitted(uint256 id) external view returns (bool) {
        return admitted[id];
    }

    function admittedAgents() external pure returns (uint256[] memory) {
        return new uint256[](0);
    }
}

contract PhronosBondVaultTest is Test {
    PhronosBondVault internal vault;
    MockERC20 internal usdc;
    MockERC20 internal usyc;
    MockUSYCTeller internal teller;
    MockIdentityRegistry internal identity;
    MockReputationRegistry internal repRegistry;
    MockBenchRegistry internal benchReg;

    address internal allocator = address(0xA11);
    address internal sentinel = address(0x5E);
    address internal slasher = address(0x51A5);
    address internal follower = address(0xF01);
    address internal trader = address(0x7AD);

    uint256 internal agentId;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        usyc = new MockERC20("US Yield Coin", "USYC", 18);
        teller = new MockUSYCTeller(address(usdc), address(usyc));
        identity = new MockIdentityRegistry();
        repRegistry = new MockReputationRegistry();
        benchReg = new MockBenchRegistry();

        vault = new PhronosBondVault(
            address(usdc),
            address(usyc),
            address(teller),
            address(identity),
            address(repRegistry),
            address(benchReg),
            slasher
        );

        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);
        vault.grantRole(vault.SENTINEL_ROLE(), sentinel);

        // Register + admit an agent
        agentId = identity.registerAgent(trader, "ipfs://card");
        benchReg.setAdmitted(agentId, true);

        // Fund accounts
        usdc.mint(follower, 1000e6);
        usdc.mint(trader, 500e6);

        vm.prank(follower);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(trader);
        usdc.approve(address(vault), type(uint256).max);
    }

    // ─── depositFollower ──────────────────────────────────────────────────────

    function test_depositFollower_firstDeposit_sharesEqualAmount() public {
        vm.prank(follower);
        uint256 shares = vault.depositFollower(100e6, "ipfs://goal");

        assertEq(shares, 100e6);
        assertEq(vault.followerShares(follower), 100e6);
        assertEq(vault.totalShares(), 100e6);
    }

    function test_depositFollower_proRata() public {
        vm.prank(follower);
        vault.depositFollower(100e6, "ipfs://goal");

        address second = address(0xF02);
        usdc.mint(second, 100e6);
        vm.prank(second);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(second);
        uint256 shares = vault.depositFollower(100e6, "ipfs://goal2");

        assertEq(shares, 100e6); // 1:1 when NAV hasn't moved
        assertEq(vault.totalShares(), 200e6);
    }

    function test_depositFollower_revert_zeroAmount() public {
        vm.prank(follower);
        vm.expectRevert(PhronosBondVault.ZeroAmount.selector);
        vault.depositFollower(0, "ipfs://goal");
    }

    function test_depositFollower_revert_paused() public {
        vault.pause();
        vm.prank(follower);
        vm.expectRevert();
        vault.depositFollower(100e6, "ipfs://goal");
    }

    // ─── withdrawFollower ─────────────────────────────────────────────────────

    function test_withdrawFollower_returnsUSDC() public {
        vm.prank(follower);
        uint256 shares = vault.depositFollower(100e6, "ipfs://goal");

        uint256 balBefore = usdc.balanceOf(follower);
        vm.prank(follower);
        uint256 amount = vault.withdrawFollower(shares);

        assertEq(amount, 100e6);
        assertEq(usdc.balanceOf(follower), balBefore + 100e6);
        assertEq(vault.followerShares(follower), 0);
        assertEq(vault.totalShares(), 0);
    }

    function test_withdrawFollower_revert_insufficientShares() public {
        vm.prank(follower);
        vault.depositFollower(100e6, "ipfs://goal");

        vm.prank(follower);
        vm.expectRevert(PhronosBondVault.InsufficientShares.selector);
        vault.withdrawFollower(200e6);
    }

    // ─── postBond ─────────────────────────────────────────────────────────────

    function test_postBond() public {
        vm.prank(trader);
        vault.postBond(agentId, 100e6);

        assertEq(vault.traderBond(agentId), 100e6);
        assertEq(vault.traderOperator(agentId), trader);
    }

    function test_postBond_revert_agentNotAdmitted() public {
        uint256 unknownId = 999;
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(PhronosBondVault.AgentNotAdmitted.selector, unknownId));
        vault.postBond(unknownId, 100e6);
    }

    function test_postBond_revert_zeroAmount() public {
        vm.prank(trader);
        vm.expectRevert(PhronosBondVault.ZeroAmount.selector);
        vault.postBond(agentId, 0);
    }

    // ─── withdrawBond ─────────────────────────────────────────────────────────

    function test_withdrawBond_afterCooldown() public {
        vm.prank(trader);
        vault.postBond(agentId, 100e6);

        vm.warp(block.timestamp + 1 days + 1);

        uint256 balBefore = usdc.balanceOf(trader);
        vm.prank(trader);
        uint256 amount = vault.withdrawBond(agentId);

        assertEq(amount, 100e6);
        assertEq(usdc.balanceOf(trader), balBefore + 100e6);
        assertEq(vault.traderBond(agentId), 0);
    }

    function test_withdrawBond_revert_cooldownNotExpired() public {
        vm.prank(trader);
        vault.postBond(agentId, 100e6);

        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(PhronosBondVault.CooldownNotExpired.selector, agentId));
        vault.withdrawBond(agentId);
    }

    function test_withdrawBond_revert_notOperator() public {
        vm.prank(trader);
        vault.postBond(agentId, 100e6);
        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSelector(PhronosBondVault.NotAgentOperator.selector, agentId));
        vault.withdrawBond(agentId);
    }

    // ─── setWeights ───────────────────────────────────────────────────────────

    function test_setWeights_valid() public {
        vm.prank(trader);
        vault.postBond(agentId, 100e6);

        uint256[] memory ids = new uint256[](1);
        ids[0] = agentId;
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;

        vm.prank(allocator);
        vault.setWeights(ids, weights);

        assertEq(vault.traderWeightBps(agentId), 10_000);
    }

    function test_setWeights_revert_sumInvalid() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = agentId;
        uint16[] memory weights = new uint16[](1);
        weights[0] = 9_000;

        vm.prank(allocator);
        vm.expectRevert(abi.encodeWithSelector(PhronosBondVault.WeightSumInvalid.selector, 9_000));
        vault.setWeights(ids, weights);
    }

    // ─── slash ────────────────────────────────────────────────────────────────

    function test_slash_reducesBond_andIncreasesFollowerPool() public {
        vm.prank(follower);
        vault.depositFollower(100e6, "ipfs://goal");

        vm.prank(trader);
        vault.postBond(agentId, 100e6);

        uint256 navBefore = vault.nav();
        uint256 bondBefore = vault.traderBond(agentId);

        vm.prank(slasher);
        vault.slash(agentId, 2500, bytes32(0));

        uint256 slashed = bondBefore * 2500 / 10_000;
        assertEq(vault.traderBond(agentId), bondBefore - slashed);
        // NAV increases because slashed USDC stays in vault and is no longer counted as bond
        assertGt(vault.nav(), navBefore);
    }

    function test_slash_revert_noBond() public {
        vm.prank(slasher);
        vm.expectRevert(abi.encodeWithSelector(PhronosBondVault.NoBondToSlash.selector, agentId));
        vault.slash(agentId, 2500, bytes32(0));
    }

    function test_slash_resetsCooldown() public {
        vm.prank(trader);
        vault.postBond(agentId, 100e6);

        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(slasher);
        vault.slash(agentId, 500, bytes32(0));

        // Cooldown reset — trader can't immediately withdraw
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(PhronosBondVault.CooldownNotExpired.selector, agentId));
        vault.withdrawBond(agentId);
    }

    // ─── payNanopayment ───────────────────────────────────────────────────────

    function test_payNanopayment() public {
        vm.prank(follower);
        vault.depositFollower(100e6, "ipfs://goal");
        vm.prank(trader);
        vault.postBond(agentId, 50e6);

        uint256 operatorBalBefore = usdc.balanceOf(trader);

        vm.prank(allocator);
        vault.payNanopayment(agentId, 1e3, bytes32("sig1")); // $0.001 USDC

        assertEq(usdc.balanceOf(trader), operatorBalBefore + 1e3);
    }

    // ─── flipToUSYC / redeemFromUSYC ─────────────────────────────────────────

    function test_flipToUSYC_updatesPosition() public {
        vm.prank(follower);
        vault.depositFollower(100e6, "ipfs://goal");

        vm.prank(sentinel);
        vault.flipToUSYC(40e6, bytes32(0), "");

        assertGt(vault.usycPosition(), 0);
    }

    function test_redeemFromUSYC_returnsUSDC() public {
        vm.prank(follower);
        vault.depositFollower(100e6, "ipfs://goal");
        vm.prank(sentinel);
        vault.flipToUSYC(40e6, bytes32(0), "");

        uint256 usycBal = vault.usycPosition();
        vm.prank(sentinel);
        usyc.approve(address(vault), type(uint256).max);

        // Approve vault's USYC (the vault holds it, not sentinel)
        // In the actual flow the vault approves internally — test the position decreases
        vm.prank(address(vault));
        usyc.approve(address(teller), usycBal);

        vm.prank(sentinel);
        vault.redeemFromUSYC(usycBal, bytes32(0), "");

        assertEq(vault.usycPosition(), 0);
    }

    // ─── anchorTrace ──────────────────────────────────────────────────────────

    function test_anchorTrace_allocator() public {
        vm.prank(allocator);
        vault.anchorTrace(keccak256("hash"), "ipfs://cid", keccak256("allocation"));
    }

    function test_anchorTrace_sentinel() public {
        vm.prank(sentinel);
        vault.anchorTrace(keccak256("hash"), "ipfs://cid", keccak256("regime"));
    }

    function test_anchorTrace_revert_unauthorized() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(PhronosBondVault.Unauthorized.selector);
        vault.anchorTrace(keccak256("hash"), "ipfs://cid", keccak256("allocation"));
    }
}
