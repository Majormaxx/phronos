"use client";
import { useState } from "react";
import {
  createPublicClient, http,
  keccak256, toHex,
} from "viem";
import { arcTestnet } from "@phronos/shared";
import { useWallet } from "@/lib/wallet-context";

const ROUTER_ABI = [{
  name: "submitIntent",
  type: "function",
  inputs: [
    { name: "intent", type: "tuple", components: [
      { name: "erc8004Id",    type: "uint256" },
      { name: "venue",        type: "uint8" },
      { name: "marketId",     type: "bytes32" },
      { name: "notionalUSDC", type: "int256" },
      { name: "validUntil",   type: "uint64" },
      { name: "nonce",        type: "uint256" },
      { name: "strategyHash", type: "bytes32" },
      { name: "traceCID",     type: "bytes32" },
    ]},
    { name: "operatorSig", type: "bytes" },
  ],
  outputs: [],
}] as const;

const INTENT_TYPES = {
  Intent: [
    { name: "erc8004Id",    type: "uint256" },
    { name: "venue",        type: "uint8" },
    { name: "marketId",     type: "bytes32" },
    { name: "notionalUSDC", type: "int256" },
    { name: "validUntil",   type: "uint64" },
    { name: "nonce",        type: "uint256" },
    { name: "strategyHash", type: "bytes32" },
    { name: "traceCID",     type: "bytes32" },
  ],
} as const;

const MARKETS = ["BTC", "ETH", "SOL"] as const;
type Market = typeof MARKETS[number];

export function SubmitIntentPanel({
  agentId,
  routerAddress,
  strategySpecCid,
}: {
  agentId:         number;
  routerAddress:   string;
  strategySpecCid: string;
}) {
  const { address: walletAddr, walletType, getWalletClient } = useWallet();
  const [market,    setMarket]    = useState<Market>("BTC");
  const [isLong,    setIsLong]    = useState(true);
  const [notional,  setNotional]  = useState("10");
  const [rationale, setRationale] = useState("");
  const [state,     setState]     = useState<"idle" | "signing" | "submitting" | "done" | "error">("idle");
  const [txHash,    setTxHash]    = useState<string | null>(null);
  const [errMsg,    setErrMsg]    = useState<string | null>(null);

  // Circle SCA wallets use P-256 (secp256r1) — the Router verifies via ecrecover (secp256k1).
  // These are incompatible without EIP-1271 in the Router contract.
  if (walletType === "circle-sca") {
    return (
      <div className="border border-ink/10 p-5 mb-8">
        <p className="text-xs font-mono text-ink/50 mb-2">Intent signing requires an EOA wallet</p>
        <p className="text-xs text-ink/30 leading-relaxed">
          Circle passkey wallets use a different signing curve (P-256) than the one Phronos Router
          verifies on-chain (secp256k1). Switch to MetaMask or any EVM wallet to submit signals.
        </p>
      </div>
    );
  }

  async function submit() {
    if (!walletAddr) { setErrMsg("Connect your wallet first."); return; }

    setState("signing");
    setErrMsg(null);

    try {
      const notionalUsd   = parseFloat(notional);
      const notionalMicro = BigInt(Math.round(notionalUsd * 1_000_000));
      const signed        = isLong ? notionalMicro : -notionalMicro;
      const validUntil    = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
      const nonce         = BigInt(Date.now());

      const traceObj = {
        schemaVersion: "trace/1.0",
        agentId:       agentId.toString(),
        market,
        direction:     isLong ? "LONG" : "SHORT",
        notionalUSDC:  signed.toString(),
        rationale:     rationale || `Manual ${isLong ? "LONG" : "SHORT"} ${market} intent`,
        timestamp:     Math.floor(Date.now() / 1000),
      };
      const traceCID      = keccak256(toHex(JSON.stringify(traceObj))) as `0x${string}`;
      const strategyHash  = keccak256(toHex(strategySpecCid)) as `0x${string}`;
      const marketId      = keccak256(toHex(market)) as `0x${string}`;

      const wc = await getWalletClient();

      const intentMsg = {
        erc8004Id:    BigInt(agentId),
        venue:        0,
        marketId,
        notionalUSDC: signed,
        validUntil,
        nonce,
        strategyHash,
        traceCID,
      };

      const sig = await wc.signTypedData({
        domain: {
          name:              "Phronos Router",
          version:           "1",
          chainId:           BigInt(arcTestnet.id),
          verifyingContract: routerAddress as `0x${string}`,
        },
        types:       INTENT_TYPES,
        primaryType: "Intent",
        message:     intentMsg,
        account:     walletAddr as `0x${string}`,
      });

      setState("submitting");

      const pubClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const { request } = await pubClient.simulateContract({
        address:      routerAddress as `0x${string}`,
        abi:          ROUTER_ABI,
        functionName: "submitIntent",
        args:         [intentMsg, sig],
        account:      walletAddr as `0x${string}`,
      });
      const hash = await wc.writeContract(request);
      await pubClient.waitForTransactionReceipt({ hash });

      setTxHash(hash);
      setState("done");
      setRationale("");
    } catch (e: any) {
      setErrMsg(e.shortMessage ?? e.message ?? "Failed");
      setState("error");
    }
  }

  return (
    <div className="border border-olive/20 bg-olive/[0.03] p-5 mb-8">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-1.5 h-1.5 rounded-full bg-olive animate-pulse" />
        <p className="text-xs font-mono text-olive/70 uppercase tracking-wider">Submit intent — you are the operator</p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        {/* Market */}
        <div>
          <label className="text-[10px] font-mono text-ink/30 uppercase tracking-wider mb-1.5 block">Market</label>
          <div className="flex flex-col gap-1">
            {MARKETS.map(m => (
              <button key={m} onClick={() => setMarket(m)}
                className={`text-xs font-mono py-1.5 border transition-colors
                  ${market === m ? "border-ink/40 text-ink bg-ink/5" : "border-ink/10 text-ink/40 hover:border-ink/20"}`}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Direction */}
        <div>
          <label className="text-[10px] font-mono text-ink/30 uppercase tracking-wider mb-1.5 block">Direction</label>
          <div className="flex flex-col gap-1">
            <button onClick={() => setIsLong(true)}
              className={`text-xs font-mono py-1.5 border transition-colors
                ${isLong ? "border-olive/50 text-olive bg-olive/10" : "border-ink/10 text-ink/40 hover:border-ink/20"}`}>
              LONG
            </button>
            <button onClick={() => setIsLong(false)}
              className={`text-xs font-mono py-1.5 border transition-colors
                ${!isLong ? "border-terracotta/50 text-terracotta bg-terracotta/10" : "border-ink/10 text-ink/40 hover:border-ink/20"}`}>
              SHORT
            </button>
          </div>
        </div>

        {/* Notional */}
        <div>
          <label className="text-[10px] font-mono text-ink/30 uppercase tracking-wider mb-1.5 block">Notional (USDC)</label>
          <div className="flex items-center gap-1 border border-ink/10 px-2 py-1.5">
            <span className="text-xs text-ink/30">$</span>
            <input
              type="number" min="2" step="1" value={notional}
              onChange={e => setNotional(e.target.value)}
              className="flex-1 bg-transparent text-xs text-ink focus:outline-none w-full"
            />
          </div>
          <p className="text-[10px] text-ink/20 mt-1">min $2</p>
        </div>
      </div>

      {/* Rationale */}
      <div className="mb-4">
        <label className="text-[10px] font-mono text-ink/30 uppercase tracking-wider mb-1.5 block">
          Rationale <span className="text-ink/20">(optional — goes in the trace)</span>
        </label>
        <input
          type="text" value={rationale} onChange={e => setRationale(e.target.value)}
          placeholder="e.g. ETH funding turned positive, entering long"
          className="w-full bg-ink/5 border border-ink/10 px-3 py-2 text-xs text-ink placeholder:text-ink/20 focus:outline-none focus:border-ink/30"
        />
      </div>

      {/* Submit */}
      <button
        onClick={submit}
        disabled={state === "signing" || state === "submitting"}
        className="w-full py-2.5 text-sm font-mono border border-olive/30 text-olive hover:bg-olive/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {state === "idle"       ? `Submit ${isLong ? "LONG" : "SHORT"} ${market} intent` :
         state === "signing"    ? "Sign in wallet…" :
         state === "submitting" ? "Confirming on Arc…" :
         state === "done"       ? "Intent submitted ✓" :
         "Retry"}
      </button>

      {state === "done" && txHash && (
        <p className="text-[10px] font-mono text-ink/30 mt-2 truncate">
          tx: {txHash}
        </p>
      )}

      {errMsg && (
        <p className="text-xs text-terracotta mt-2">{errMsg}</p>
      )}
    </div>
  );
}
