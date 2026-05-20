"use client";

import { useState } from "react";

type Mode = "investor" | "savings" | null;
type Style = "steady" | "balanced" | "aggressive" | "protected" | "protected-upside" | null;
type Horizon = 7 | 30 | 90 | null;

interface IntentState {
  mode: Mode;
  style: Style;
  horizon: Horizon;
  amount: string;
}

interface OnboardingFlowProps {
  onComplete: (intent: IntentState) => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [intent, setIntent] = useState<IntentState>({
    mode: null,
    style: null,
    horizon: null,
    amount: "",
  });

  function preview(): string {
    if (intent.mode === "savings" && intent.style === "protected") {
      return "Most of your funds will sit in a protected, yield-bearing position. A small slice goes to steady-growth strategies, with the council monitoring conditions hourly.";
    }
    if (intent.mode === "investor" && intent.style === "aggressive") {
      return "Your council will prioritise high-conviction growth strategies and adjust allocations every 30 minutes. If market conditions turn volatile, a portion of your funds will automatically shift to a protected position.";
    }
    if (intent.mode === "investor" && intent.style === "steady") {
      return "Your council will balance growth and safety, favouring strategies with consistent track records. Funds shift toward protection automatically when conditions deteriorate.";
    }
    return "Your council will manage your funds according to your stated goal, rebalancing every 30 minutes and shifting to protection when conditions warrant.";
  }

  return (
    <div className="max-w-lg mx-auto py-16 px-4">

      {/* Step 1 — Mode */}
      {step === 1 && (
        <div>
          <p className="font-mono text-terracotta text-sm mb-6">Step 1 of 4</p>
          <h2 className="font-display text-4xl mb-8">How do you want to use Phronos?</h2>
          <div className="space-y-4">
            {([
              {
                value: "investor" as Mode,
                label: "Investor Mode",
                desc: "Put my money to work. Growth focus, comfortable with some movement.",
              },
              {
                value: "savings" as Mode,
                label: "Savings Mode",
                desc: "Keep my money safe. Steady, protected growth.",
              },
            ] as const).map(({ value, label, desc }) => (
              <button
                key={value}
                onClick={() => { setIntent((s) => ({ ...s, mode: value })); setStep(2); }}
                className="w-full text-left card hover:border-terracotta/40 transition-colors p-6"
              >
                <p className="font-display text-xl mb-1">{label}</p>
                <p className="text-ink/60 text-sm">{desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2 — Style */}
      {step === 2 && intent.mode === "investor" && (
        <div>
          <p className="font-mono text-terracotta text-sm mb-6">Step 2 of 4</p>
          <h2 className="font-display text-4xl mb-8">What's your approach?</h2>
          <div className="space-y-4">
            {([
              { value: "steady" as Style, label: "Steady growth", desc: "Moderate risk. Good starting point for first-time depositors." },
              { value: "balanced" as Style, label: "Balanced", desc: "The council's default. Growth-focused with a safety net if markets turn." },
              { value: "aggressive" as Style, label: "Aggressive", desc: "Full growth focus. Higher upside, higher swings." },
            ] as const).map(({ value, label, desc }) => (
              <button
                key={value}
                onClick={() => { setIntent((s) => ({ ...s, style: value })); setStep(3); }}
                className="w-full text-left card hover:border-terracotta/40 transition-colors p-6"
              >
                <p className="font-display text-xl mb-1">{label}</p>
                <p className="text-ink/60 text-sm">{desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && intent.mode === "savings" && (
        <div>
          <p className="font-mono text-terracotta text-sm mb-6">Step 2 of 4</p>
          <h2 className="font-display text-4xl mb-8">How protected do you want to be?</h2>
          <div className="space-y-4">
            {([
              { value: "protected" as Style, label: "Fully protected", desc: "Most funds sit in a stable, yield-bearing position. Minimal market exposure." },
              { value: "protected-upside" as Style, label: "Protected with upside", desc: "Mostly safe, with a small allocation to growth strategies." },
            ] as const).map(({ value, label, desc }) => (
              <button
                key={value}
                onClick={() => { setIntent((s) => ({ ...s, style: value })); setStep(3); }}
                className="w-full text-left card hover:border-terracotta/40 transition-colors p-6"
              >
                <p className="font-display text-xl mb-1">{label}</p>
                <p className="text-ink/60 text-sm">{desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 3 — Horizon + amount */}
      {step === 3 && (
        <div>
          <p className="font-mono text-terracotta text-sm mb-6">Step 3 of 4</p>
          <h2 className="font-display text-4xl mb-8">How long and how much?</h2>

          <div className="mb-8">
            <p className="text-sm text-ink/60 mb-3">Time horizon</p>
            <div className="flex gap-3">
              {([7, 30, 90] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setIntent((s) => ({ ...s, horizon: h }))}
                  className={`px-5 py-2 border text-sm transition-colors ${
                    intent.horizon === h
                      ? "border-terracotta bg-terracotta/10 text-terracotta"
                      : "border-ink/20 hover:border-ink/40"
                  }`}
                >
                  {h} days
                </button>
              ))}
            </div>
          </div>

          <div className="mb-8">
            <p className="text-sm text-ink/60 mb-3">Starting amount</p>
            <div className="flex items-center border border-ink/20 focus-within:border-terracotta/60 transition-colors">
              <span className="px-4 text-ink/40 select-none">$</span>
              <input
                type="number"
                min="10"
                placeholder="100"
                value={intent.amount}
                onChange={(e) => setIntent((s) => ({ ...s, amount: e.target.value }))}
                className="flex-1 py-3 pr-4 bg-transparent outline-none text-ink"
              />
            </div>
            <p className="text-xs text-ink/40 mt-2">You can add more or take out funds at any time.</p>
          </div>

          <button
            disabled={!intent.horizon || !intent.amount}
            onClick={() => setStep(4)}
            className="btn-primary w-full disabled:opacity-40"
          >
            Preview
          </button>
        </div>
      )}

      {/* Step 4 — Preview */}
      {step === 4 && (
        <div>
          <p className="font-mono text-terracotta text-sm mb-6">Step 4 of 4</p>
          <h2 className="font-display text-4xl mb-6">Here's how your council will manage this:</h2>

          <div className="card mb-6">
            <p className="text-ink/80 leading-relaxed">{preview()}</p>
          </div>

          {/* Visual split bar */}
          <div className="mb-8">
            <div className="flex h-3 w-full overflow-hidden rounded-full">
              <div
                className="bg-terracotta h-full transition-all"
                style={{
                  width: intent.mode === "savings" && intent.style === "protected" ? "10%" : "65%",
                }}
              />
              <div className="bg-olive h-full flex-1" />
            </div>
            <div className="flex justify-between text-xs text-ink/50 mt-2">
              <span>Growth strategies</span>
              <span>Protected funds</span>
            </div>
          </div>

          <button onClick={() => onComplete(intent)} className="btn-primary w-full mb-3">
            Create my account and start
          </button>
          <button
            onClick={() => setStep(1)}
            className="w-full text-center text-sm text-ink/50 hover:text-ink/80 py-2 transition-colors"
          >
            Start over
          </button>
        </div>
      )}

      {/* Back button */}
      {step > 1 && (
        <button
          onClick={() => setStep((s) => (s - 1) as typeof step)}
          className="mt-8 text-sm text-ink/40 hover:text-ink/70 transition-colors"
        >
          ← Back
        </button>
      )}
    </div>
  );
}
