// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PhronosRegistry} from "../src/PhronosRegistry.sol";

interface IIdentityRegistry {
    function register(string calldata metadataURI) external returns (uint256 tokenId);
}

/// @notice Register 4 trader agents on ERC-8004 and PhronosRegistry only.
/// Bond posting is done separately via cast send (avoids Arc USDC precompile quirks).
contract RegisterAgentsOnly is Script {
    address constant IDENTITY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    function run() external {
        address registryAddr = vm.envAddress("PHRONOS_REGISTRY_ADDR");

        IIdentityRegistry identity = IIdentityRegistry(IDENTITY);
        PhronosRegistry   registry = PhronosRegistry(registryAddr);

        string[4] memory names       = ["Momentum", "Mean Reversion", "Funding Rate", "Random Walk"];
        string[4] memory cardUris    = [
            "phronos:trader-01:momentum",
            "phronos:trader-02:mean-reversion",
            "phronos:trader-03:funding-rate",
            "phronos:trader-04:random-walk"
        ];
        string[4] memory strategyCids = [
            "phronos:strategy:momentum-24h-top3",
            "phronos:strategy:mean-revert-24h-fade",
            "phronos:strategy:funding-rate-hl",
            "phronos:strategy:random-walk-stochastic"
        ];

        vm.startBroadcast();

        uint256[4] memory agentIds;
        for (uint256 i = 0; i < 4; i++) {
            agentIds[i] = identity.register(cardUris[i]);
            console.log("ERC-8004 registered:", names[i], "id:", agentIds[i]);
        }

        for (uint256 i = 0; i < 4; i++) {
            registry.register(agentIds[i], cardUris[i], strategyCids[i]);
            console.log("PhronosRegistry registered:", names[i], "id:", agentIds[i]);
        }

        vm.stopBroadcast();

        console.log("--- next: post bonds via cast send ---");
        for (uint256 i = 0; i < 4; i++) {
            console.log("TRADER_0", i + 1, "_AGENT_ID=", agentIds[i]);
        }
    }
}
