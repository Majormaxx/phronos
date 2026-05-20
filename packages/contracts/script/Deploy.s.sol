// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {BenchRegistry} from "../src/BenchRegistry.sol";
import {SlashOracle} from "../src/SlashOracle.sol";
import {PhronosBondVault} from "../src/PhronosBondVault.sol";

/// @notice Deploy order: BenchRegistry → SlashOracle → PhronosBondVault → grant roles.
/// Usage: forge script script/Deploy.s.sol --rpc-url $ARC_TESTNET_RPC --broadcast
contract Deploy is Script {
    // Arc Testnet — all addresses imported from env or constants; never inline.
    address constant USDC = 0x3600000000000000000000000000000000000000;
    address constant USYC = 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C;
    address constant USYC_TELLER = 0x9fdF14c5B14173D74C08Af27AebFf39240dC105A;
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    function run() external {
        address allocatorWorker = vm.envAddress("ALLOCATOR_WORKER_ADDRESS");
        address sentinelWorker = vm.envAddress("SENTINEL_WORKER_ADDRESS");
        address keeperWorker = vm.envAddress("KEEPER_WORKER_ADDRESS");

        vm.startBroadcast();

        // 1. BenchRegistry
        BenchRegistry bench = new BenchRegistry(IDENTITY_REGISTRY);
        console.log("BenchRegistry:", address(bench));

        // 2. SlashOracle — vault address unknown yet; set after vault deploy
        //    Deploy with a placeholder, then update via constructor re-deploy or proxy.
        //    For hackathon: deploy vault first with a dummy slashOracle, then deploy real oracle.
        //    Simpler: deploy oracle with vault address after vault is known.
        //    We use a two-pass approach via env var — see README for instructions.
        address slashOracleAddr = vm.envOr("SLASH_ORACLE_ADDRESS", address(0));

        PhronosBondVault vault;
        SlashOracle oracle;

        if (slashOracleAddr == address(0)) {
            // First pass: deploy vault with deployer as temporary slasher, then deploy oracle.
            vault = new PhronosBondVault(
                USDC, USYC, USYC_TELLER, IDENTITY_REGISTRY, REPUTATION_REGISTRY,
                address(bench), msg.sender // deployer as temp slasher
            );
            console.log("PhronosBondVault:", address(vault));

            oracle = new SlashOracle(address(vault));
            console.log("SlashOracle:", address(oracle));

            // Swap slasher role to oracle, revoke from deployer
            vault.grantRole(vault.SLASHER_ROLE(), address(oracle));
            vault.revokeRole(vault.SLASHER_ROLE(), msg.sender);
        } else {
            // Re-run: oracle already deployed, just wire vault.
            vault = new PhronosBondVault(
                USDC, USYC, USYC_TELLER, IDENTITY_REGISTRY, REPUTATION_REGISTRY,
                address(bench), slashOracleAddr
            );
            console.log("PhronosBondVault:", address(vault));
            oracle = SlashOracle(slashOracleAddr);
        }

        // 3. Grant roles to worker SCAs
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocatorWorker);
        vault.grantRole(vault.SENTINEL_ROLE(), sentinelWorker);
        oracle.grantRole(oracle.KEEPER_ROLE(), keeperWorker);

        vm.stopBroadcast();

        // Print deployment summary for deployments/arc-testnet.json
        console.log("--- deployment summary ---");
        console.log("BENCH_REGISTRY_ADDRESS=%s", address(bench));
        console.log("SLASH_ORACLE_ADDRESS=%s", address(oracle));
        console.log("VAULT_ADDRESS=%s", address(vault));
    }
}
