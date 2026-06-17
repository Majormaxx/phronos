"use client";
import { useState } from "react";

export function ShareButton({ label = "Share" }: { label?: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={share}
      className="text-xs font-mono text-ink/40 hover:text-ink border border-ink/10 px-3 py-1.5 transition-colors"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
