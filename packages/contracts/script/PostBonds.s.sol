// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PhronosBond} from "../src/PhronosBond.sol";

/// @notice Post USDC bonds for the 4 registered Phronos agents.
/// Run after RegisterAndBondUsyc.s.sol fails at the Teller step (USYC entitlements not granted).
/// The ERC-8004 mints and registry registrations are already on-chain.
contract PostBonds is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 constant BOND = 2_000_000; // 2 USDC per agent

    function run() external {
        address bondAddr = vm.envAddress("PHRONOS_BOND_ADDR");

        uint256 id1 = vm.envUint("TRADER_01_AGENT_ID");
        uint256 id2 = vm.envUint("TRADER_02_AGENT_ID");
        uint256 id3 = vm.envUint("TRADER_03_AGENT_ID");
        uint256 id4 = vm.envUint("TRADER_04_AGENT_ID");

        IERC20      usdc = IERC20(USDC);
        PhronosBond bond = PhronosBond(bondAddr);

        vm.startBroadcast();

        usdc.approve(bondAddr, BOND * 4);

        bond.postBond(id1, BOND);
        console.log("Bond posted: Momentum    id=", id1);

        bond.postBond(id2, BOND);
        console.log("Bond posted: Mean Rev    id=", id2);

        bond.postBond(id3, BOND);
        console.log("Bond posted: Funding     id=", id3);

        bond.postBond(id4, BOND);
        console.log("Bond posted: Random Walk id=", id4);

        vm.stopBroadcast();
    }
}
