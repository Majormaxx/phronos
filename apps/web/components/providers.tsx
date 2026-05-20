"use client";

import { AppKitProvider } from "@circle-fin/app-kit";

// NOTE: The chain enum on App Kit is "Arc_Testnet" — different from the
// Developer Wallets SDK which uses "ARC-TESTNET". Logged in PRODUCT_FEEDBACK.md.
const SUPPORTED_CHAINS = ["Arc_Testnet"] as const;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AppKitProvider
      appId={process.env.NEXT_PUBLIC_CIRCLE_APP_ID!}
      chains={SUPPORTED_CHAINS}
    >
      {children}
    </AppKitProvider>
  );
}
