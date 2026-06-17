// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PhronosRegistry} from "../src/PhronosRegistry.sol";
import {PhronosBond} from "../src/PhronosBond.sol";

interface IIdentityRegistry {
    function register(string calldata metadataURI) external returns (uint256 tokenId);
}

/// @notice Register 4 Phronos agents on ERC-8004 + PhronosRegistry, then post USDC bonds.
/// Uses USDC bonds (postBond) — the USYC path (postBondUsyc) is available in the contract
/// but requires USYC Teller entitlements for the operator address.
contract RegisterAndBond is Script {
    address constant USDC     = 0x3600000000000000000000000000000000000000;
    address constant IDENTITY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    uint256 constant BOND     = 2_000_000; // 2 USDC per agent (6 decimals)

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
    string[4] internal NAMES = ["Momentum", "Mean Reversion", "Funding Rate", "Random Walk"];

    function run() external {
        address registryAddr = vm.envAddress("PHRONOS_REGISTRY_ADDR");
        address bondAddr     = vm.envAddress("PHRONOS_BOND_ADDR");

        IIdentityRegistry identity = IIdentityRegistry(IDENTITY);
        PhronosRegistry   registry = PhronosRegistry(registryAddr);
        PhronosBond       bond     = PhronosBond(bondAddr);
        IERC20            usdc     = IERC20(USDC);

        vm.startBroadcast();

        uint256[4] memory ids;

        // Step 1: Mint ERC-8004 identity tokens
        for (uint256 i = 0; i < 4; i++) {
            ids[i] = identity.register(CARD_URIS[i]);
            console.log("ERC-8004 minted:", NAMES[i], "id:", ids[i]);
        }

        // Step 2: Register in PhronosRegistry (operator = msg.sender = allowlisted address)
        for (uint256 i = 0; i < 4; i++) {
            registry.register(ids[i], CARD_URIS[i], STRATEGY_CIDS[i]);
            console.log("PhronosRegistry registered:", NAMES[i]);
        }

        // Step 3: Post USDC bonds
        usdc.approve(bondAddr, BOND * 4);
        for (uint256 i = 0; i < 4; i++) {
            bond.postBond(ids[i], BOND);
            console.log("Bond posted: 2 USDC for", NAMES[i]);
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== paste into .env ===");
        console.log("TRADER_01_AGENT_ID=", ids[0]);
        console.log("TRADER_02_AGENT_ID=", ids[1]);
        console.log("TRADER_03_AGENT_ID=", ids[2]);
        console.log("TRADER_04_AGENT_ID=", ids[3]);
    }
}
