// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PhronosRegistry} from "../src/PhronosRegistry.sol";
import {PhronosBond} from "../src/PhronosBond.sol";
import {PhronosRouter} from "../src/PhronosRouter.sol";
import {SlashOracle} from "../src/SlashOracle.sol";

/// @notice V3 deploy: adds Stork oracle verification to SlashOracle and
/// wires ERC-8183 AgenticCommerce + ERC-8004 Reputation into PhronosRouter.
///
/// New vs V2:
///   - PhronosRouter.setJobFactory(JOB_FACTORY)   — ERC-8183 job receipts per copy
///   - PhronosRouter.setReputationRegistry(REP)   — ERC-8004 rep writes on copy/refusal
///   - SlashOracle.setOracle(stork, assetId)       — Stork price freshness before slash
///
/// Usage:
///   forge script script/DeployV3.s.sol \
///     --rpc-url $ARC_TESTNET_RPC \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast -vvv
///
/// Optional env:
///   STORK_ORACLE_ADDR   — Stork EVM contract on Arc Testnet (set when available)
///   STORK_ASSET_ID      — bytes32 hex asset ID for BTC/USD (e.g. 0x4254435553440000...)
contract DeployV3 is Script {
    address constant USDC                = 0x3600000000000000000000000000000000000000;
    address constant USYC                = 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C;
    address constant USYC_TELLER         = 0x9fdF14c5B14173D74C08Af27AebFf39240dC105A;
    address constant IDENTITY_REGISTRY   = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;
    address constant JOB_FACTORY         = 0x0747EEf0706327138c69792bF28Cd525089e4583;

    function run() external {
        address keeperWorker = vm.envAddress("KEEPER_WORKER_ADDRESS");
        address routerWorker = vm.envAddress("ROUTER_WORKER_ADDRESS");

        bool usycMode   = vm.envOr("USYC_MODE", false);
        address usycAddr   = usycMode ? USYC        : address(0);
        address tellerAddr = usycMode ? USYC_TELLER : address(0);

        // Stork oracle — optional, address(0) disables freshness check
        address storkOracle = vm.envOr("STORK_ORACLE_ADDR", address(0));
        bytes32 storkAssetId;
        if (storkOracle != address(0)) {
            storkAssetId = vm.envBytes32("STORK_ASSET_ID");
        }

        if (usycMode) {
            console.log("Deploying with real USYC");
        } else {
            console.log("Deploying in USDC-only mode");
        }
        if (storkOracle != address(0)) {
            console.log("Stork oracle:", storkOracle);
        } else {
            console.log("No Stork oracle (set STORK_ORACLE_ADDR when available)");
        }

        vm.startBroadcast();

        // 1. PhronosRegistry
        PhronosRegistry reg = new PhronosRegistry(IDENTITY_REGISTRY);
        console.log("PhronosRegistry:       ", address(reg));

        // 2. PhronosRouter — with ERC-8183 + ERC-8004 rep integration
        PhronosRouter router = new PhronosRouter(USDC, address(reg));
        router.setJobFactory(JOB_FACTORY);
        router.setReputationRegistry(REPUTATION_REGISTRY);
        console.log("PhronosRouter:         ", address(router));
        console.log("  jobFactory set:      ", JOB_FACTORY);
        console.log("  reputationReg set:   ", REPUTATION_REGISTRY);

        // 3. PhronosBond
        PhronosBond bond = new PhronosBond(USDC, usycAddr, tellerAddr, address(reg), address(router));
        console.log("PhronosBond:           ", address(bond));

        // 4. SlashOracle — with optional Stork oracle freshness verification
        SlashOracle oracle = new SlashOracle(address(bond), REPUTATION_REGISTRY);
        if (storkOracle != address(0)) {
            oracle.setOracle(storkOracle, storkAssetId);
            console.log("SlashOracle oracle set:", storkOracle);
        }
        console.log("SlashOracle:           ", address(oracle));

        // 5. Wire roles
        bond.grantRole(bond.SLASHER_ROLE(), address(oracle));
        oracle.grantRole(oracle.KEEPER_ROLE(), keeperWorker);
        router.grantRole(router.VENUE_ROLE(), routerWorker);

        vm.stopBroadcast();

        console.log("--- paste into .env ---");
        console.log("PHRONOS_REGISTRY_ADDR=", address(reg));
        console.log("PHRONOS_ROUTER_ADDR=",   address(router));
        console.log("PHRONOS_BOND_ADDR=",     address(bond));
        console.log("SLASH_ORACLE_ADDR=",     address(oracle));
    }
}
