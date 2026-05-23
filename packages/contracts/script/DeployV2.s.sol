// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PhronosRegistry} from "../src/PhronosRegistry.sol";
import {PhronosBond} from "../src/PhronosBond.sol";
import {PhronosRouter} from "../src/PhronosRouter.sol";
import {SlashOracle} from "../src/SlashOracle.sol";

/// @notice Redeploy v2 Phronos contracts with fixed agentInfo ABI.
/// Reuses existing MockUSYC. Deploys fresh Registry + Router + Bond + Oracle.
///
/// Usage:
///   forge script script/DeployV2.s.sol \
///     --rpc-url $ARC_TESTNET_RPC \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast -vvv
contract DeployV2 is Script {
    address constant USDC                = 0x3600000000000000000000000000000000000000;
    address constant IDENTITY_REGISTRY   = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    function run() external {
        address keeperWorker = vm.envAddress("KEEPER_WORKER_ADDRESS");
        address routerWorker = vm.envAddress("ROUTER_WORKER_ADDRESS");

        vm.startBroadcast();

        // 1. PhronosRegistry — fixed: agentInfo returns individual values, not struct memory.
        PhronosRegistry registry = new PhronosRegistry(IDENTITY_REGISTRY);
        console.log("PhronosRegistry:  ", address(registry));

        // 2. PhronosRouter — follower escrow and signed intent processing.
        PhronosRouter router = new PhronosRouter(USDC, address(registry));
        console.log("PhronosRouter:    ", address(router));

        // 3. PhronosBond — USDC-backed bonds; slashed USDC forwarded to router pool.
        PhronosBond bond = new PhronosBond(USDC, address(registry), address(router));
        console.log("PhronosBond:      ", address(bond));

        // 4. SlashOracle — Sharpe-decay slash schedule + ERC-8004 reputation writes.
        SlashOracle oracle = new SlashOracle(address(bond), REPUTATION_REGISTRY);
        console.log("SlashOracle:      ", address(oracle));

        // 5. Wire roles.
        bond.grantRole(bond.SLASHER_ROLE(), address(oracle));
        oracle.grantRole(oracle.KEEPER_ROLE(), keeperWorker);
        router.grantRole(router.VENUE_ROLE(), routerWorker);

        vm.stopBroadcast();

        console.log("--- paste into .env ---");
        console.log("PHRONOS_REGISTRY_ADDR=", address(registry));
        console.log("PHRONOS_ROUTER_ADDR=",   address(router));
        console.log("PHRONOS_BOND_ADDR=",     address(bond));
        console.log("SLASH_ORACLE_ADDR=",     address(oracle));
    }
}
