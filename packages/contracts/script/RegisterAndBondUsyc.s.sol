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

interface IUsycTeller {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function previewDeposit(uint256 assets) external view returns (uint256 shares);
}

/// @notice Full registration + USYC bond posting for all 4 Phronos trader agents.
///
/// Prerequisites:
///   1. DEPLOYER_PRIVATE_KEY must be the allowlisted address (0x4e36ee...).
///   2. That address must hold enough USDC for 4 × MIN_BOND_USDC (default: 4 × 2 USDC = 8 USDC).
///   3. PHRONOS_REGISTRY_ADDR and PHRONOS_BOND_ADDR must be set from fresh DeployV2 run.
///
/// What it does (single broadcast from allowlisted address):
///   1. Register 4 fresh ERC-8004 identity tokens.
///   2. Register each agent in PhronosRegistry (operator = allowlisted deployer).
///   3. Approve USDC → USYC Teller.
///   4. Deposit USDC → USYC via Teller (deployer receives shares — allowlist covers this).
///   5. Approve USYC shares → PhronosBond.
///   6. Post yield-bearing USYC bond for each agent via PhronosBond.postBondUsyc().
///
/// Usage:
///   USYC_MODE=true forge script script/RegisterAndBondUsyc.s.sol \
///     --rpc-url $ARC_TESTNET_RPC \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast -vvv
contract RegisterAndBondUsyc is Script {
    address constant USDC            = 0x3600000000000000000000000000000000000000;
    address constant USYC            = 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C;
    address constant USYC_TELLER     = 0x9fdF14c5B14173D74C08Af27AebFf39240dC105A;
    address constant IDENTITY        = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    uint256 constant BOND_PER_AGENT  = 2_000_000; // 2 USDC (6 decimals)
    uint256 constant NUM_AGENTS      = 4;

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
        IERC20            usyc     = IERC20(USYC);
        IUsycTeller       teller   = IUsycTeller(USYC_TELLER);

        vm.startBroadcast();

        // ── Step 1: Register ERC-8004 identity tokens ──────────────────────
        uint256[4] memory agentIds;
        for (uint256 i = 0; i < NUM_AGENTS; i++) {
            agentIds[i] = identity.register(CARD_URIS[i]);
            console.log("ERC-8004 minted:", NAMES[i], "id:", agentIds[i]);
        }

        // ── Step 2: Register agents in PhronosRegistry ─────────────────────
        for (uint256 i = 0; i < NUM_AGENTS; i++) {
            registry.register(agentIds[i], CARD_URIS[i], STRATEGY_CIDS[i]);
            console.log("PhronosRegistry registered:", NAMES[i]);
        }

        // ── Step 3: Deposit USDC → USYC via Teller (allowlisted deployer) ──
        uint256 totalUsdc  = BOND_PER_AGENT * NUM_AGENTS;
        usdc.approve(USYC_TELLER, totalUsdc);
        console.log("Depositing", totalUsdc, "USDC into USYC Teller...");

        // Teller.deposit(assets, receiver) — deployer is allowlisted, receiver = deployer
        address deployer = msg.sender;
        uint256 totalShares = teller.deposit(totalUsdc, deployer);
        console.log("Received USYC shares:", totalShares);

        // ── Step 4: Post USYC bonds for each agent ─────────────────────────
        // Split shares equally across 4 agents
        uint256 sharesPerAgent = totalShares / NUM_AGENTS;
        uint256 remaining      = totalShares - (sharesPerAgent * NUM_AGENTS);

        usyc.approve(bondAddr, totalShares);

        for (uint256 i = 0; i < NUM_AGENTS; i++) {
            // Give the remainder to the last agent (rounding dust)
            uint256 shares = (i == NUM_AGENTS - 1) ? sharesPerAgent + remaining : sharesPerAgent;
            bond.postBondUsyc(agentIds[i], shares);
            console.log("USYC bond posted:", NAMES[i], "shares:", shares);
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== paste into .env ===");
        console.log("TRADER_01_AGENT_ID=", agentIds[0]);
        console.log("TRADER_02_AGENT_ID=", agentIds[1]);
        console.log("TRADER_03_AGENT_ID=", agentIds[2]);
        console.log("TRADER_04_AGENT_ID=", agentIds[3]);
        console.log("");
        console.log("Also update signing keys - all 4 traders should use DEPLOYER_PRIVATE_KEY");
        console.log("until DCW wallets are set as operators via: pnpm tsx apps/workers/agents/setup-dcw.ts");
    }
}
