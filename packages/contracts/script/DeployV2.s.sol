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
    // Real USYC on Arc Testnet — accessible once allowlisted.
    // Pass address(0) to disable USYC and use USDC-only mode.
    address constant USYC                = 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C;
    address constant USYC_TELLER         = 0x9fdF14c5B14173D74C08Af27AebFf39240dC105A;
    address constant IDENTITY_REGISTRY   = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    function run() external {
        address keeperWorker = vm.envAddress("KEEPER_WORKER_ADDRESS");
        address routerWorker = vm.envAddress("ROUTER_WORKER_ADDRESS");

        // Set USYC_MODE=true in env to deploy with real USYC (requires allowlisted deployer).
        // Default: USDC-only fallback (USYC + Teller passed as zero address).
        bool usycMode = vm.envOr("USYC_MODE", false);
        address usycAddr   = usycMode ? USYC       : address(0);
        address tellerAddr = usycMode ? USYC_TELLER : address(0);

        if (usycMode) {
            console.log("Deploying with real USYC - deployer must be USYC-allowlisted");
        } else {
            console.log("Deploying in USDC-only mode (set USYC_MODE=true for real USYC)");
        }

        vm.startBroadcast();

        // 1. PhronosRegistry — includes updateOperator() for DCW operator migration.
        PhronosRegistry registry = new PhronosRegistry(IDENTITY_REGISTRY);
        console.log("PhronosRegistry:  ", address(registry));

        // 2. PhronosRouter — follower escrow and signed intent processing.
        PhronosRouter router = new PhronosRouter(USDC, address(registry));
        console.log("PhronosRouter:    ", address(router));

        // 3. PhronosBond — yield-bearing USYC bonds (or USDC fallback).
        PhronosBond bond = new PhronosBond(USDC, usycAddr, tellerAddr, address(registry), address(router));
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
