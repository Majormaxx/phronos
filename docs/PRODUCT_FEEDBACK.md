# PRODUCT_FEEDBACK.md

Concrete developer pain points encountered while building Phronos. Each entry includes the file/line where the issue surfaced and a suggested fix. Updated throughout the hackathon.

---

## Format

```
### [Product] — [Short title]
**Where:** file:line or workflow step
**What happened:** one paragraph, specific
**Suggested fix:** one paragraph
```

---

### App Kit — Chain enum casing inconsistency
**Where:** `apps/web/components/providers.tsx`
**What happened:** App Kit uses `"Arc_Testnet"` as the chain enum, while the Developer Wallets SDK uses `"ARC-TESTNET"`. Both refer to the same network. Code that passes chain strings across SDK boundaries needs a mapping layer or silent failures occur.
**Suggested fix:** Standardise on one casing (prefer `"ARC-TESTNET"` to match ISO style) across all Circle SDKs, or export a shared enum from a single canonical package.

### Web3.Storage — API key deprecation mid-hackathon
**Where:** `packages/shared/src/ipfs.ts`
**What happened:** Web3.Storage migrated from simple API key auth to the w3up model. The legacy `/upload` endpoint still accepts the old token format but the SDK docs no longer cover it. Developers who followed the docs hit 401s immediately.
**Suggested fix:** Maintain a stable simple-auth upload endpoint or provide a clear migration guide with a 90-day overlap window. The w3up client requires local key generation and UCAN delegation — significant setup for a hackathon.
