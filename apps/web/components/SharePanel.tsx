"use client";
import { useState } from "react";

interface Props {
  url?:  string;  // defaults to window.location.href
  text:  string;  // pre-filled share text (no URL — appended automatically)
  label?: string;
  compact?: boolean; // icon-only mode for tight spaces
}

export function SharePanel({ url, text, label = "Share", compact = false }: Props) {
  const [copied, setCopied] = useState(false);

  function getUrl() {
    return url ?? (typeof window !== "undefined" ? window.location.href : "");
  }

  function shareX() {
    const u = encodeURIComponent(getUrl());
    const t = encodeURIComponent(`${text}\n\n`);
    window.open(`https://twitter.com/intent/tweet?text=${t}&url=${u}`, "_blank", "noopener,width=550,height=420");
  }

  function shareTelegram() {
    const u = encodeURIComponent(getUrl());
    const t = encodeURIComponent(text);
    window.open(`https://t.me/share/url?url=${u}&text=${t}`, "_blank", "noopener");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(getUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select a temp input
      const el = document.createElement("input");
      el.value = getUrl();
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={shareX}
          title="Share on X"
          className="p-1.5 text-ink/30 hover:text-ink border border-ink/10 hover:border-ink/30 transition-colors"
        >
          {/* X logo */}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.735l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
          </svg>
        </button>
        <button
          onClick={shareTelegram}
          title="Share on Telegram"
          className="p-1.5 text-ink/30 hover:text-ink border border-ink/10 hover:border-ink/30 transition-colors"
        >
          {/* Telegram paper-plane */}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
          </svg>
        </button>
        <button
          onClick={copyLink}
          title="Copy link"
          className="p-1.5 text-ink/30 hover:text-ink border border-ink/10 hover:border-ink/30 transition-colors"
        >
          {copied
            ? <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
            : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          }
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-ink/25 font-mono hidden sm:inline">{label}</span>
      <button
        onClick={shareX}
        className="flex items-center gap-1.5 text-xs font-mono text-ink/40 hover:text-ink border border-ink/10 hover:border-ink/30 px-2.5 py-1.5 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.735l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
        </svg>
        Post
      </button>
      <button
        onClick={shareTelegram}
        className="flex items-center gap-1.5 text-xs font-mono text-ink/40 hover:text-ink border border-ink/10 hover:border-ink/30 px-2.5 py-1.5 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
        </svg>
        Send
      </button>
      <button
        onClick={copyLink}
        className="flex items-center gap-1.5 text-xs font-mono text-ink/30 hover:text-ink/60 border border-ink/8 hover:border-ink/20 px-2.5 py-1.5 transition-colors"
      >
        {copied ? "Copied ✓" : "Copy link"}
      </button>
    </div>
  );
}
