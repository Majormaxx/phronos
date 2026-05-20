"use client";

import { useState, useEffect } from "react";
import { SignIn, UnifiedBalance } from "@circle-fin/app-kit";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { DashboardView } from "@/components/DashboardView";

type AppState = "loading" | "unauthenticated" | "onboarding" | "dashboard";

export function DashboardShell() {
  const [state, setState] = useState<AppState>("loading");
  const [address, setAddress] = useState<string>("");
  const [hasDeposited, setHasDeposited] = useState(false);

  // Vault and bench state — fetched from API
  const [vaultData, setVaultData] = useState<Record<string, unknown> | null>(null);
  const [benchData, setBenchData] = useState<unknown[]>([]);

  useEffect(() => {
    // Check wallet connection status
    // Circle App Kit exposes wallet state via hooks — adapt based on actual SDK API
    const savedAddress = sessionStorage.getItem("phronos_address");
    const savedDeposited = sessionStorage.getItem("phronos_deposited") === "true";

    if (savedAddress) {
      setAddress(savedAddress);
      setHasDeposited(savedDeposited);
      setState(savedDeposited ? "dashboard" : "onboarding");
      fetchData();
    } else {
      setState("unauthenticated");
    }
  }, []);

  async function fetchData() {
    const [vault, bench] = await Promise.all([
      fetch("/api/vault/state").then((r) => r.json()),
      fetch("/api/bench").then((r) => r.json()),
    ]);
    setVaultData(vault);
    setBenchData(bench);
  }

  function handleSignIn(addr: string) {
    setAddress(addr);
    sessionStorage.setItem("phronos_address", addr);
    setState("onboarding");
  }

  async function handleOnboardingComplete(intent: unknown) {
    // POST goal to API, then trigger Circle App Kit deposit flow
    await fetch("/api/goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: intent, address }),
    });
    sessionStorage.setItem("phronos_deposited", "true");
    setHasDeposited(true);
    setState("dashboard");
    fetchData();
  }

  if (state === "loading") {
    return <p className="text-center py-32 text-ink/40">Loading…</p>;
  }

  if (state === "unauthenticated") {
    return (
      <div className="max-w-md mx-auto py-24 px-4 text-center">
        <h1 className="font-display text-4xl mb-4">Open the agora</h1>
        <p className="text-ink/60 mb-10">
          Sign in with email or social to create your account. No seed phrase.
        </p>
        <div className="flex justify-center">
          {/* Circle App Kit SignIn component */}
          <SignIn
            onSuccess={(user: { address: string }) => handleSignIn(user.address)}
          />
        </div>
      </div>
    );
  }

  if (state === "onboarding") {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  // Dashboard — derive props from fetched data
  const vault = vaultData as Record<string, unknown> | null;
  const agents = (benchData as Array<Record<string, unknown>>).map((a) => ({
    agentId: String(a.agentId),
    persona: String(a.persona),
    weightBps: Number(a.weightBps ?? 0),
    bondUSDC: String(a.bondUSDC ?? "0"),
    sharpe7d: Number(a.sharpe7d ?? 0),
    lastSignal: a.lastSignal as { direction: string; market: string; at: string } | null,
  }));

  return (
    <DashboardView
      address={address}
      shareBalance="0"
      shareValueUSDC={String(vault?.navUSDC ?? "0.00")}
      changeUSDC="0.00"
      changePositive
      vault={{
        navUSDC: String(vault?.navUSDC ?? "0"),
        usycPct: Number(vault?.usycPct ?? 0),
        growthPct: 100 - Number(vault?.usycPct ?? 0),
        totalFollowers: Number(vault?.totalFollowers ?? 0),
        totalSlashed: String(vault?.totalSlashed ?? "0.00"),
        lastRebalancedAt: String(vault?.lastRebalancedAt ?? "—"),
      }}
      agents={agents}
      activity={[]}
    />
  );
}
