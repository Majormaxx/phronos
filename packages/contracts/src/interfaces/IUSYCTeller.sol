// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Boring Vault TellerWithMultiAssetSupport — verify exact signatures against
// deployed Teller at 0x9fdF14c5B14173D74C08Af27AebFf39240dC105A on Arc Testnet Day 1.
interface IUSYCTeller {
    function deposit(address depositAsset, uint256 depositAmount, uint256 minimumMint)
        external
        returns (uint256 shares);

    function bulkWithdraw(address withdrawAsset, uint256 shareAmount, uint256 minimumAssets, address to)
        external
        returns (uint256 assetsOut);
}
