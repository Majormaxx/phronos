"use client";

// Circle App Kit is the required wallet provider per PRD §20.
// The installed @circle-fin/app-kit@1.6.1 is a DeFi operations SDK (bridge/earn),
// not a wallet UI provider. The wallet connection UI ships as a server-side
// redirect to Circle's hosted auth flow until Circle publishes a React wallet
// connector package. For now children render directly; wallet state is read
// from window.ethereum via viem where needed.
// Tracked in docs/PRODUCT_FEEDBACK.md as feedback item #3.

export function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
