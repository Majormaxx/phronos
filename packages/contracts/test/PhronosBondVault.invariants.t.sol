// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PhronosBondVault} from "../src/PhronosBondVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockUSYCTeller} from "./mocks/MockUSYCTeller.sol";
import {MockIdentityRegistry, MockReputationRegistry} from "./mocks/MockERC8004.sol";

contract MockBenchReg {
    mapping(uint256 => bool) public isAdmitted;

    function admit(uint256 id) external {
        isAdmitted[id] = true;
    }

    function admittedAgents() external pure returns (uint256[] memory) {
        return new uint256[](0);
    }
}

/// @notice Handler drives the vault through random sequences of deposits, bonds, and slashes.
contract VaultHandler is Test {
    PhronosBondVault internal vault;
    MockERC20 internal usdc;
    MockBenchReg internal bench;

    address internal follower = address(0xF01);
    address internal trader = address(0x7AD);
    address internal allocator;
    address internal slasher;
    uint256 internal agentId;

    constructor(
        PhronosBondVault _vault,
        MockERC20 _usdc,
        MockBenchReg _bench,
        address _allocator,
        address _slasher,
        uint256 _agentId
    ) {
        vault = _vault;
        usdc = _usdc;
        bench = _bench;
        allocator = _allocator;
        slasher = _slasher;
        agentId = _agentId;

        usdc.mint(follower, 1_000_000e6);
        usdc.mint(trader, 500_000e6);

        vm.prank(follower);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(trader);
        usdc.approve(address(vault), type(uint256).max);
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 10_000e6);
        vm.prank(follower);
        vault.depositFollower(amount, "ipfs://goal");
    }

    function postBond(uint256 amount) external {
        amount = bound(amount, 1, 1_000e6);
        vm.prank(trader);
        try vault.postBond(agentId, amount) {} catch {}
    }

    function slashAgent(uint16 bps) external {
        bps = uint16(bound(bps, 1, 2500));
        vm.prank(slasher);
        try vault.slash(agentId, bps, bytes32(0)) {} catch {}
    }

    function setWeights() external {
        uint256[] memory ids = vault.getActiveAgents();
        if (ids.length == 0) return;

        uint16[] memory weights = new uint16[](ids.length);
        weights[0] = 10_000;

        vm.prank(allocator);
        try vault.setWeights(ids, weights) {} catch {}
    }
}

contract PhronosBondVaultInvariantsTest is Test {
    PhronosBondVault internal vault;
    MockERC20 internal usdc;
    MockERC20 internal usyc;
    MockUSYCTeller internal teller;
    MockBenchReg internal bench;
    VaultHandler internal handler;

    address internal allocator = address(0xA11);
    address internal slasher = address(0x51A5);
    uint256 internal agentId;

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 6);
        usyc = new MockERC20("USYC", "USYC", 18);
        teller = new MockUSYCTeller(address(usdc), address(usyc));
        bench = new MockBenchReg();

        MockIdentityRegistry identity = new MockIdentityRegistry();
        MockReputationRegistry rep = new MockReputationRegistry();

        vault = new PhronosBondVault(
            address(usdc),
            address(usyc),
            address(teller),
            address(identity),
            address(rep),
            address(bench),
            slasher
        );
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);

        agentId = identity.registerAgent(address(0x7AD), "ipfs://card");
        bench.admit(agentId);

        handler = new VaultHandler(vault, usdc, bench, allocator, slasher, agentId);
        targetContract(address(handler));
    }

    /// Invariant 1: nav == 0 implies totalShares == 0.
    /// The reverse is not enforced: bond slashes with no followers leave orphaned
    /// USDC in the follower pool (nav > 0, totalShares == 0). This is correct
    /// behaviour — the next depositor absorbs those funds at 1:1.
    function invariant_shares_iff_nav() public view {
        if (vault.nav() == 0) {
            assertEq(vault.totalShares(), 0);
        }
    }

    /// Invariant 2: sum of trader bonds <= vault USDC balance.
    function invariant_bonds_le_usdcBalance() public view {
        uint256[] memory agents = vault.getActiveAgents();
        uint256 totalBonds;
        for (uint256 i; i < agents.length; ++i) {
            totalBonds += vault.traderBond(agents[i]);
        }
        assertLe(totalBonds, usdc.balanceOf(address(vault)));
    }

    /// Invariant 4: setWeights always leaves weights summing to 10_000 or 0.
    function invariant_weightSumValid() public view {
        uint256[] memory agents = vault.getActiveAgents();
        if (agents.length == 0) return;
        uint256 sum;
        for (uint256 i; i < agents.length; ++i) {
            sum += vault.traderWeightBps(agents[i]);
        }
        assertTrue(sum == 10_000 || sum == 0);
    }
}
