"use client";
import { useState, useEffect, useRef } from "react";

interface Props {
  url?:     string;
  text:     string;
  label?:   string;
  compact?: boolean;
}

export function SharePanel({ url, text, label = "Share", compact = false }: Props) {
  const [open,   setOpen]   = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function getUrl() {
    return url ?? (typeof window !== "undefined" ? window.location.href : "");
  }

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);

  function shareX() {
    const u = encodeURIComponent(getUrl());
    const t = encodeURIComponent(`${text}\n\n`);
    window.open(`https://twitter.com/intent/tweet?text=${t}&url=${u}`, "_blank", "noopener,width=550,height=420");
    setOpen(false);
  }

  function shareTelegram() {
    const u = encodeURIComponent(getUrl());
    const t = encodeURIComponent(text);
    window.open(`https://t.me/share/url?url=${u}&text=${t}`, "_blank", "noopener");
    setOpen(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(getUrl());
    } catch {
      const el = document.createElement("input");
      el.value = getUrl();
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => { setCopied(false); setOpen(false); }, 1200);
  }

  const trigger = compact ? (
    <button
      onClick={() => setOpen(v => !v)}
      className="p-1.5 text-ink/30 hover:text-ink border border-ink/10 hover:border-ink/30 transition-colors"
      title="Share"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
    </button>
  ) : (
    <button
      onClick={() => setOpen(v => !v)}
      className="flex items-center gap-1.5 text-xs font-mono text-ink/40 hover:text-ink border border-ink/10 hover:border-ink/30 px-2.5 py-1.5 transition-colors"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
      {label}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      {trigger}

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 bg-[#0C0C0E] border border-ink/20 shadow-2xl shadow-black/60">
          {/* URL row */}
          <div className="flex items-center gap-2 px-3 py-3 border-b border-ink/10">
            <p className="text-[10px] font-mono text-ink/30 truncate flex-1 min-w-0">
              {getUrl().replace("https://", "")}
            </p>
            <button
              onClick={copyLink}
              className={`text-[10px] font-mono shrink-0 px-2 py-1 border transition-colors
                ${copied
                  ? "border-olive/30 text-olive bg-olive/10"
                  : "border-ink/20 text-ink/50 hover:text-ink hover:border-ink/40"}`}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>

          {/* Share options */}
          <div className="p-2 space-y-0.5">
            <button
              onClick={shareX}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-ink/60 hover:text-ink hover:bg-ink/8 transition-colors text-left"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.735l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
              </svg>
              <div>
                <p className="font-medium text-ink/80">Post on X</p>
                <p className="text-[10px] text-ink/30 font-mono">Opens tweet composer</p>
              </div>
            </button>

            <button
              onClick={shareTelegram}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-ink/60 hover:text-ink hover:bg-ink/8 transition-colors text-left"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
              </svg>
              <div>
                <p className="font-medium text-ink/80">Send on Telegram</p>
                <p className="text-[10px] text-ink/30 font-mono">Opens Telegram share</p>
              </div>
            </button>
          </div>

          {/* Pre-filled text preview */}
          <div className="px-3 pb-3">
            <p className="text-[10px] text-ink/20 font-mono leading-relaxed whitespace-pre-line border-t border-ink/8 pt-2.5">
              {text.length > 140 ? text.slice(0, 137) + "…" : text}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
