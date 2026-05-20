// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {BenchRegistry} from "../src/BenchRegistry.sol";
import {MockIdentityRegistry} from "./mocks/MockERC8004.sol";

contract BenchRegistryTest is Test {
    BenchRegistry internal registry;
    MockIdentityRegistry internal identity;

    address internal admin = address(this);

    function setUp() public {
        identity = new MockIdentityRegistry();
        registry = new BenchRegistry(address(identity));
    }

    function _registerAgent(address operator) internal returns (uint256 agentId) {
        agentId = identity.registerAgent(operator, "ipfs://card");
    }

    function test_admit() public {
        uint256 id = _registerAgent(address(0x1));
        registry.admit(id);
        assertTrue(registry.isAdmitted(id));
        assertEq(registry.admittedAgents().length, 1);
        assertEq(registry.admittedAgents()[0], id);
    }

    function test_admit_revert_agentNotRegistered() public {
        vm.expectRevert(abi.encodeWithSelector(BenchRegistry.AgentNotRegistered.selector, 999));
        registry.admit(999);
    }

    function test_admit_revert_alreadyAdmitted() public {
        uint256 id = _registerAgent(address(0x1));
        registry.admit(id);
        vm.expectRevert(abi.encodeWithSelector(BenchRegistry.AgentAlreadyAdmitted.selector, id));
        registry.admit(id);
    }

    function test_admit_revert_notAdmin() public {
        uint256 id = _registerAgent(address(0x1));
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        registry.admit(id);
    }

    function test_expel() public {
        uint256 id = _registerAgent(address(0x1));
        registry.admit(id);
        registry.expel(id);
        assertFalse(registry.isAdmitted(id));
        assertEq(registry.admittedAgents().length, 0);
    }

    function test_expel_revert_notAdmitted() public {
        vm.expectRevert(abi.encodeWithSelector(BenchRegistry.AgentNotAdmitted.selector, 999));
        registry.expel(999);
    }

    function test_expel_swapAndPop_preservesRemainingAgents() public {
        uint256 id1 = _registerAgent(address(0x1));
        uint256 id2 = _registerAgent(address(0x2));
        uint256 id3 = _registerAgent(address(0x3));
        registry.admit(id1);
        registry.admit(id2);
        registry.admit(id3);

        // Expel the first — id3 should swap into slot 0
        registry.expel(id1);

        assertEq(registry.admittedAgents().length, 2);
        assertFalse(registry.isAdmitted(id1));
        assertTrue(registry.isAdmitted(id2));
        assertTrue(registry.isAdmitted(id3));
    }

    function test_pause_blocksAdmit() public {
        registry.pause();
        uint256 id = _registerAgent(address(0x1));
        vm.expectRevert();
        registry.admit(id);
    }

    function test_unpause_allowsAdmit() public {
        registry.pause();
        registry.unpause();
        uint256 id = _registerAgent(address(0x1));
        registry.admit(id);
        assertTrue(registry.isAdmitted(id));
    }
}
