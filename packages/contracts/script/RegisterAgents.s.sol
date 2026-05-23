// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BenchRegistry} from "../src/BenchRegistry.sol";

/// @dev ERC-8004 IdentityRegistry — ERC-721 with register(metadataURI)
interface IIdentityRegistry {
    function register(string calldata metadataURI) external returns (uint256 tokenId);
    function agentExists(uint256 agentId) external view returns (bool);
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IVault {
    function postBond(uint256 agentId, uint256 amount) external;
}

/// @notice Register 6 trader agents on ERC-8004, admit to BenchRegistry, post bonds.
/// Usage: forge script script/RegisterAgents.s.sol --rpc-url $RPC --broadcast -vvv
contract RegisterAgents is Script {
    address constant USDC     = 0x3600000000000000000000000000000000000000;
    address constant IDENTITY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    uint256 constant BOND_PER_AGENT = 2_000_000; // 2 USDC (6 decimals)

    string[6] internal NAMES = [
        "Momentum",
        "Mean Reversion",
        "News Breaker",
        "Funding Rate",
        "Random Walk",
        "Copy HL"
    ];

    string[6] internal CARD_URIS = [
        "phronos:trader-01:momentum",
        "phronos:trader-02:mean-reversion",
        "phronos:trader-03:news-breaker",
        "phronos:trader-04:funding-rate",
        "phronos:trader-05:random-walk",
        "phronos:trader-06:copy-hl"
    ];

    function run() external {
        address benchAddr = vm.envAddress("BENCH_REGISTRY_ADDRESS");
        address vaultAddr = vm.envAddress("VAULT_ADDRESS");

        IIdentityRegistry identity = IIdentityRegistry(IDENTITY);
        BenchRegistry bench        = BenchRegistry(benchAddr);
        IVault vault               = IVault(vaultAddr);
        IERC20 usdc                = IERC20(USDC);

        vm.startBroadcast();

        usdc.approve(vaultAddr, BOND_PER_AGENT * 6);

        console.log("--- agent registration ---");
        for (uint256 i = 0; i < 6; i++) {
            uint256 agentId = identity.register(CARD_URIS[i]);
            console.log("Registered:", NAMES[i], "agentId:", agentId);

            bench.admit(agentId);
            console.log("Admitted:  ", NAMES[i]);

            vault.postBond(agentId, BOND_PER_AGENT);
            console.log("Bond posted:", NAMES[i], "2 USDC");
        }

        vm.stopBroadcast();
        console.log("--- paste agent IDs into .env ---");
    }
}
