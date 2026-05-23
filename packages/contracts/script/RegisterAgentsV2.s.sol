// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PhronosRegistry} from "../src/PhronosRegistry.sol";
import {PhronosBond} from "../src/PhronosBond.sol";

interface IIdentityRegistry {
    function register(string calldata metadataURI) external returns (uint256 tokenId);
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice Register 4 trader agents on ERC-8004, register in PhronosRegistry, post bonds.
/// Agent 1 (ID 18146) is already registered on ERC-8004; skip that step.
contract RegisterAgentsV2 is Script {
    address constant USDC     = 0x3600000000000000000000000000000000000000;
    address constant IDENTITY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    uint256 constant BOND_PER_AGENT      = 2_000_000; // 2 USDC (6 decimals)
    uint256 constant EXISTING_AGENT_ID   = 18146;     // Momentum — already on ERC-8004

    string[4] internal NAMES = ["Momentum", "Mean Reversion", "Funding Rate", "Random Walk"];
    string[4] internal CARD_URIS = [
        "phronos:trader-01:momentum",
        "phronos:trader-02:mean-reversion",
        "phronos:trader-03:funding-rate",
        "phronos:trader-04:random-walk"
    ];
    string[4] internal STRATEGY_CIDS = [
        "phronos:strategy:momentum-24h-top3",
        "phronos:strategy:mean-revert-24h-fade",
        "phronos:strategy:funding-rate-hl",
        "phronos:strategy:random-walk-stochastic"
    ];

    function run() external {
        address registryAddr = vm.envAddress("PHRONOS_REGISTRY_ADDR");
        address bondAddr     = vm.envAddress("PHRONOS_BOND_ADDR");

        IIdentityRegistry identity = IIdentityRegistry(IDENTITY);
        PhronosRegistry   registry = PhronosRegistry(registryAddr);
        PhronosBond       bond     = PhronosBond(bondAddr);
        IERC20            usdc     = IERC20(USDC);

        vm.startBroadcast();

        // Approve bond contract for all 4 bonds
        usdc.approve(bondAddr, BOND_PER_AGENT * 4);

        uint256[4] memory agentIds;
        // Register all 4 fresh on ERC-8004 (deployer owns all tokens)
        for (uint256 i = 0; i < 4; i++) {
            agentIds[i] = identity.register(CARD_URIS[i]);
            console.log("ERC-8004 registered:", NAMES[i], "id:", agentIds[i]);
        }

        // Register all 4 in PhronosRegistry
        for (uint256 i = 0; i < 4; i++) {
            registry.register(agentIds[i], CARD_URIS[i], STRATEGY_CIDS[i]);
            console.log("PhronosRegistry registered:", NAMES[i], "id:", agentIds[i]);
        }

        // Post bonds for all 4
        for (uint256 i = 0; i < 4; i++) {
            bond.postBond(agentIds[i], BOND_PER_AGENT);
            console.log("Bond posted:", NAMES[i], "2 USDC, id:", agentIds[i]);
        }

        vm.stopBroadcast();

        console.log("--- paste into .env ---");
        console.log("TRADER_01_AGENT_ID=", agentIds[0]);
        console.log("TRADER_02_AGENT_ID=", agentIds[1]);
        console.log("TRADER_03_AGENT_ID=", agentIds[2]);
        console.log("TRADER_04_AGENT_ID=", agentIds[3]);
    }
}
