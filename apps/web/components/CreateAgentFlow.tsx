"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createPublicClient, http,
  parseAbi, keccak256, toHex, encodeFunctionData,
} from "viem";
import { arcTestnet, addresses, getDeployedAddresses } from "@phronos/shared";
import { useWallet } from "@/lib/wallet-context";

const ERC8004_ABI = parseAbi([
  "function registerAgent(address operator, string agentCardCid) external returns (uint256 agentId)",
]);
const REGISTRY_ABI = parseAbi([
  "function register(uint256 erc8004Id, string agentCardCID, string strategySpecCID) external",
]);
const USDC_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
]);
const BOND_ABI = parseAbi([
  "function postBond(uint256 erc8004Id, uint256 usdcAmount) external",
]);

const MARKETS   = ["BTC", "ETH", "BTC + ETH"] as const;
const STRATS    = ["Momentum", "Mean Reversion", "Funding Rate Arb", "Custom"] as const;

type Step = 1 | 2 | 3 | 4;

interface TxStatus {
  label:  string;
  state:  "pending" | "loading" | "done" | "error";
  error?: string;
}

export function CreateAgentFlow() {
  const router = useRouter();

  const { address: walletAddr, walletType, getWalletClient, getSCAClient } = useWallet();

  // form fields
  const [name,        setName]        = useState("");
  const [description, setDescription] = useState("");
  const [market,      setMarket]      = useState<typeof MARKETS[number]>("BTC");
  const [strategy,    setStrategy]    = useState<typeof STRATS[number]>("Momentum");
  const [bondUsd,     setBondUsd]     = useState("5");

  // deploy state
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [step,        setStep]        = useState<Step>(1);
  const [newAgentId,  setNewAgentId]  = useState<number | null>(null);
  const [txStatuses,  setTxStatuses]  = useState<TxStatus[]>([]);
  const [deployError, setDeployError] = useState<string | null>(null);

  useEffect(() => {
    if (!walletAddr || step !== 2) return;
    const pubClient = createPublicClient({ chain: arcTestnet, transport: http() });
    pubClient.readContract({
      address: addresses.USDC, abi: USDC_ABI,
      functionName: "balanceOf", args: [walletAddr as `0x${string}`],
    }).then(bal => setUsdcBalance(Number(bal) / 1_000_000)).catch(() => {});
  }, [walletAddr, step]);

  function setTxState(idx: number, update: Partial<TxStatus>) {
    setTxStatuses(prev => prev.map((t, i) => i === idx ? { ...t, ...update } : t));
  }

  async function deploy() {
    setDeployError(null);
    if (!walletAddr) { setDeployError("Connect your wallet first."); return; }

    const bondAmount = Math.round(parseFloat(bondUsd) * 1_000_000);
    if (bondAmount < 2_000_000) { setDeployError("Minimum bond is $2 USDC."); return; }

    const { registry: registryAddr, bond: bondAddr } = getDeployedAddresses();

    const agentCardObj = { name, description, market, strategyType: strategy, version: "1", createdAt: new Date().toISOString() };
    const strategySpecObj = { type: strategy, market, description };
    const agentCardCidStr    = `phronos:agent-card:${keccak256(toHex(JSON.stringify(agentCardObj)))}`;
    const strategySpecCidStr = `phronos:strategy:${keccak256(toHex(JSON.stringify(strategySpecObj)))}`;

    const isSCA = walletType === "circle-sca";
    const initStatuses: TxStatus[] = isSCA
      ? [
          { label: "Mint ERC-8004 identity (gasless)",              state: "pending" },
          { label: "Register with Phronos",                          state: "pending" },
          { label: "Approve USDC + post bond (1 gasless operation)", state: "pending" },
        ]
      : [
          { label: "Mint ERC-8004 identity",  state: "pending" },
          { label: "Register with Phronos",   state: "pending" },
          { label: "Approve USDC",            state: "pending" },
          { label: "Post bond",               state: "pending" },
        ];
    setTxStatuses(initStatuses);
    setStep(3);

    try {
      const pubClient = createPublicClient({ chain: arcTestnet, transport: http() });

      // ── Tx 1: mint ERC-8004 ──────────────────────────────────────────────
      setTxState(0, { state: "loading" });
      let agentId: bigint;
      try {
        // Simulate to get the predicted agentId, then execute
        const { result, request } = await pubClient.simulateContract({
          address: addresses.IDENTITY_REGISTRY, abi: ERC8004_ABI,
          functionName: "registerAgent",
          args: [walletAddr as `0x${string}`, agentCardCidStr],
          account: walletAddr as `0x${string}`,
        });
        agentId = result as bigint;

        if (isSCA) {
          const sca = await getSCAClient();
          await (sca as any).sendUserOperation({
            calls: [{ to: addresses.IDENTITY_REGISTRY, data: encodeFunctionData({ abi: ERC8004_ABI, functionName: "registerAgent", args: [walletAddr as `0x${string}`, agentCardCidStr] }) }],
            paymaster: true,
          });
          // Brief pause to let the UserOp be included before the next step
          await new Promise(r => setTimeout(r, 3000));
        } else {
          const wc   = await getWalletClient();
          const hash = await wc.writeContract(request);
          await pubClient.waitForTransactionReceipt({ hash });
        }
        setTxState(0, { state: "done" });
      } catch (e: any) {
        setTxState(0, { state: "error", error: e.shortMessage ?? e.message });
        throw e;
      }

      // ── Tx 2: register in PhronosRegistry ────────────────────────────────
      setTxState(1, { state: "loading" });
      try {
        if (isSCA) {
          const sca = await getSCAClient();
          await (sca as any).sendUserOperation({
            calls: [{ to: registryAddr, data: encodeFunctionData({ abi: REGISTRY_ABI, functionName: "register", args: [agentId!, agentCardCidStr, strategySpecCidStr] }) }],
            paymaster: true,
          });
          await new Promise(r => setTimeout(r, 3000));
        } else {
          const wc = await getWalletClient();
          const { request } = await pubClient.simulateContract({
            address: registryAddr as `0x${string}`, abi: REGISTRY_ABI,
            functionName: "register",
            args: [agentId!, agentCardCidStr, strategySpecCidStr],
            account: walletAddr as `0x${string}`,
          });
          const hash = await wc.writeContract(request);
          await pubClient.waitForTransactionReceipt({ hash });
        }
        setTxState(1, { state: "done" });
      } catch (e: any) {
        setTxState(1, { state: "error", error: e.shortMessage ?? e.message });
        throw e;
      }

      // ── Tx 3 (+ 4 for SCA): approve USDC [+ post bond] ──────────────────
      setTxState(2, { state: "loading" });
      try {
        if (isSCA) {
          // Batch approve + postBond into one gasless UserOperation
          const sca = await getSCAClient();
          await (sca as any).sendUserOperation({
            calls: [
              { to: addresses.USDC,           data: encodeFunctionData({ abi: USDC_ABI,  functionName: "approve",  args: [bondAddr as `0x${string}`, BigInt(bondAmount)] }) },
              { to: bondAddr as `0x${string}`, data: encodeFunctionData({ abi: BOND_ABI, functionName: "postBond", args: [agentId!, BigInt(bondAmount)] }) },
            ],
            paymaster: true,
          });
          setTxState(2, { state: "done" });
        } else {
          // ── Tx 3: approve ────────────────────────────────────────────────
          const wc3 = await getWalletClient();
          const { request: req3 } = await pubClient.simulateContract({
            address: addresses.USDC, abi: USDC_ABI,
            functionName: "approve",
            args: [bondAddr as `0x${string}`, BigInt(bondAmount)],
            account: walletAddr as `0x${string}`,
          });
          await pubClient.waitForTransactionReceipt({ hash: await wc3.writeContract(req3) });
          setTxState(2, { state: "done" });

          // ── Tx 4: post bond ──────────────────────────────────────────────
          setTxState(3, { state: "loading" });
          const wc4 = await getWalletClient();
          const { request: req4 } = await pubClient.simulateContract({
            address: bondAddr as `0x${string}`, abi: BOND_ABI,
            functionName: "postBond",
            args: [agentId!, BigInt(bondAmount)],
            account: walletAddr as `0x${string}`,
          });
          await pubClient.waitForTransactionReceipt({ hash: await wc4.writeContract(req4) });
          setTxState(3, { state: "done" });
        }
      } catch (e: any) {
        setTxState(isSCA ? 2 : 3, { state: "error", error: e.shortMessage ?? e.message });
        throw e;
      }

      // Persist human-readable metadata so profile + leaderboard can show the name
      await fetch("/api/agent-meta", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          erc8004Id:    Number(agentId),
          name,
          description,
          strategyType: strategy,
          market,
          createdBy:    walletAddr,
        }),
      }).catch(() => {/* non-fatal */});

      setNewAgentId(Number(agentId));
      setStep(4);
    } catch (e: any) {
      setDeployError(e.shortMessage ?? e.message ?? "Transaction failed");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <Link href="/leaderboard" className="text-xs text-ink/40 hover:text-ink/70 mb-8 inline-block">
        ← Leaderboard
      </Link>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {([1, 2, 3, 4] as Step[]).map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono
              ${step === s ? "bg-ink text-surface" : step > s ? "bg-olive/30 text-olive" : "bg-ink/10 text-ink/30"}`}>
              {step > s ? "✓" : s}
            </div>
            {s < 4 && <div className={`h-px w-6 ${step > s ? "bg-olive/30" : "bg-ink/10"}`} />}
          </div>
        ))}
      </div>

      {/* ── Step 1: Strategy ─────────────────────────────────────────────── */}
      {step === 1 && (
        <div>
          <h1 className="font-display text-4xl mb-1">Your strategy</h1>
          <p className="text-ink/40 text-sm mb-8">This goes on-chain. Be specific — your followers will read it.</p>

          <div className="space-y-5">
            <div>
              <label className="text-xs font-mono text-ink/40 uppercase tracking-wider mb-1.5 block">Agent name</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. ETH Momentum Alpha"
                className="w-full bg-ink/5 border border-ink/10 px-3 py-2.5 text-sm text-ink placeholder:text-ink/20 focus:outline-none focus:border-ink/30"
              />
            </div>

            <div>
              <label className="text-xs font-mono text-ink/40 uppercase tracking-wider mb-1.5 block">Strategy description</label>
              <textarea
                value={description} onChange={e => setDescription(e.target.value)} rows={3}
                placeholder="e.g. Buys ETH when 24h momentum is positive and funding rates favour longs. Exits after 30 minutes or on macro shift."
                className="w-full bg-ink/5 border border-ink/10 px-3 py-2.5 text-sm text-ink placeholder:text-ink/20 focus:outline-none focus:border-ink/30 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-mono text-ink/40 uppercase tracking-wider mb-1.5 block">Market focus</label>
                <div className="flex flex-col gap-1.5">
                  {MARKETS.map(m => (
                    <button key={m} onClick={() => setMarket(m)}
                      className={`text-left text-sm px-3 py-2 border transition-colors
                        ${market === m ? "border-ink/40 text-ink bg-ink/5" : "border-ink/10 text-ink/40 hover:border-ink/20"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-mono text-ink/40 uppercase tracking-wider mb-1.5 block">Strategy type</label>
                <div className="flex flex-col gap-1.5">
                  {STRATS.map(s => (
                    <button key={s} onClick={() => setStrategy(s)}
                      className={`text-left text-sm px-3 py-2 border transition-colors
                        ${strategy === s ? "border-ink/40 text-ink bg-ink/5" : "border-ink/10 text-ink/40 hover:border-ink/20"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={!name.trim() || !description.trim()}
            className="btn-primary w-full mt-8 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next: set your bond →
          </button>
        </div>
      )}

      {/* ── Step 2: Bond ─────────────────────────────────────────────────── */}
      {step === 2 && (
        <div>
          <h1 className="font-display text-4xl mb-1">Post your bond</h1>
          <p className="text-ink/40 text-sm mb-8">
            This USDC is locked against your ERC-8004 identity. If your Sharpe drops below threshold,
            it goes directly to your followers — not a treasury.
          </p>

          {!walletAddr && (
            <div className="border border-ink/10 p-4 mb-6 text-sm text-ink/50">
              Connect your wallet using the button in the top-right nav first.
            </div>
          )}

          {walletAddr && (
            <div className="border border-ink/10 p-4 mb-6 text-xs font-mono text-ink/40 space-y-1">
              <p>Wallet: {walletAddr.slice(0,12)}…{walletAddr.slice(-4)}</p>
              <p>USDC balance: {usdcBalance === null ? "…" : `$${usdcBalance.toFixed(2)}`}</p>
              {usdcBalance !== null && usdcBalance < 2 && (
                <p className="text-terracotta mt-2">
                  Insufficient balance. Get testnet USDC from the Arc testnet faucet before continuing.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-mono text-ink/40 uppercase tracking-wider mb-1.5 block">Bond amount (USDC)</label>
            <div className="flex items-center gap-3">
              <span className="text-ink/40 text-sm">$</span>
              <input
                type="number" min="2" step="1"
                value={bondUsd} onChange={e => setBondUsd(e.target.value)}
                className="flex-1 bg-ink/5 border border-ink/10 px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-ink/30"
              />
            </div>
            <p className="text-xs text-ink/30 mt-2">Minimum $2. Higher bonds signal stronger conviction and attract more followers.</p>
          </div>

          <div className="mt-8 p-4 border border-ink/8 text-xs text-ink/40 space-y-1">
            <p>You are about to execute 4 transactions:</p>
            <p>1. Mint ERC-8004 identity on Arc</p>
            <p>2. Register with PhronosRegistry</p>
            <p>3. Approve USDC spend</p>
            <p>4. Post bond to PhronosBond</p>
          </div>

          <div className="flex gap-3 mt-6">
            <button onClick={() => setStep(1)} className="btn-ghost text-sm flex-1">← Back</button>
            <button
              onClick={deploy}
              disabled={!walletAddr || !bondUsd || parseFloat(bondUsd) < 2 || (usdcBalance !== null && usdcBalance < parseFloat(bondUsd))}
              className="btn-primary text-sm flex-1 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Deploy on-chain →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Deploying ─────────────────────────────────────────────── */}
      {step === 3 && (
        <div>
          <h1 className="font-display text-4xl mb-1">Deploying</h1>
          <p className="text-ink/40 text-sm mb-8">Approve each transaction in your wallet.</p>

          <div className="space-y-3">
            {txStatuses.map((tx, i) => (
              <div key={i} className="flex items-center gap-4 p-4 border border-ink/8">
                <div className={`w-5 h-5 shrink-0 flex items-center justify-center rounded-full text-xs
                  ${tx.state === "done"    ? "bg-olive/20 text-olive" :
                    tx.state === "loading" ? "bg-ink/10 text-ink" :
                    tx.state === "error"   ? "bg-terracotta/20 text-terracotta" :
                    "bg-ink/5 text-ink/20"}`}>
                  {tx.state === "done"    ? "✓" :
                   tx.state === "loading" ? <span className="animate-pulse">·</span> :
                   tx.state === "error"   ? "✕" :
                   String(i + 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${tx.state === "loading" ? "text-ink" : tx.state === "done" ? "text-ink/50" : "text-ink/30"}`}>
                    {tx.label}
                  </p>
                  {tx.state === "loading" && (
                    <p className="text-xs text-ink/30 mt-0.5">Waiting for confirmation…</p>
                  )}
                  {tx.error && (
                    <p className="text-xs text-terracotta mt-0.5 truncate">{tx.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {deployError && (
            <div className="mt-4 p-3 border border-terracotta/20 bg-terracotta/5 text-xs text-terracotta">
              {deployError}
              <button onClick={() => { setStep(2); setDeployError(null); }} className="ml-3 underline">
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Step 4: Live ──────────────────────────────────────────────────── */}
      {step === 4 && newAgentId !== null && (
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-olive/20 flex items-center justify-center mx-auto mb-6">
            <span className="text-olive text-xl">✓</span>
          </div>
          <h1 className="font-display text-4xl mb-2">You're live</h1>
          <p className="text-ink/40 text-sm mb-2">ERC-8004 #{newAgentId} · bond posted · appearing on leaderboard</p>
          <p className="text-ink/30 text-xs mb-8 font-mono">{name}</p>

          <div className="space-y-3">
            <Link href={`/agent/${newAgentId}`}  className="btn-primary block text-center">
              Submit your first intent →
            </Link>
            <Link href={`/profile/${walletAddr}`} className="btn-ghost block text-center text-sm">
              View your profile
            </Link>
            <Link href="/leaderboard"             className="text-ink/30 hover:text-ink text-sm text-center block transition-colors">
              See the leaderboard
            </Link>
          </div>

          <p className="text-xs text-ink/30 mt-8 max-w-sm mx-auto">
            From your agent page you can submit signed trade intents directly from the browser.
            Followers who copy you will be notified on-chain within the same block.
          </p>
        </div>
      )}
    </div>
  );
}
