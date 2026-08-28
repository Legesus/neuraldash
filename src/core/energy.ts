/**
 * Energy normalization and cost helpers. No vscode imports.
 */

export function normalizeMwh(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (!s) return null;
  if (s === "\u2014" || s === "\u2013" || s === "-" || s === "\u2014" || s.toLowerCase().includes("gathering")) {
    return null;
  }
  // Strip decorators before regex
  s = s.replace(/~/g, "").replace(/\u00b7/g, "").replace(/\u2013/g, "-").replace(/\u2014/g, "-").trim();
  // standalone dash after cleanup
  if (s === "-" || s === "" ) return null;
  const m = s.match(/([\d.,]+)\s*(mWh|kWh|Wh)/i);
  if (!m) return null;
  const numStr = m[1].replace(/,/g, "");
  const val = parseFloat(numStr);
  if (Number.isNaN(val)) return null;
  const unit = m[2].toLowerCase();
  if (unit === "mwh") return val;
  if (unit === "wh") return val * 1e3;
  if (unit === "kwh") return val * 1e6;
  return null;
}

export function costPer1kUsd(mwh: number | null, tariffPerKWh: number): number | null {
  if (mwh == null || !Number.isFinite(mwh) || !Number.isFinite(tariffPerKWh)) return null;
  return (mwh * tariffPerKWh) / 1000;
}

export function costPerRequestUsd(mwh: number | null, tariffPerKWh: number): number | null {
  if (mwh == null || !Number.isFinite(mwh) || !Number.isFinite(tariffPerKWh)) return null;
  return (mwh * tariffPerKWh) / 1e6;
}

export function humanizeAge(fetchedAt: string, now: Date = new Date()): string {
  const then = new Date(fetchedAt).getTime();
  const nowMs = now.getTime();
  if (Number.isNaN(then)) return "unknown";
  const diffMs = nowMs - then;
  if (diffMs < 0) return "just now";
  if (diffMs < 60_000) return "just now";
  if (diffMs < 60 * 60_000) {
    const m = Math.floor(diffMs / 60_000);
    return `${m}m ago`;
  }
  if (diffMs < 24 * 60 * 60_000) {
    const h = Math.floor(diffMs / (60 * 60_000));
    return `${h}h ago`;
  }
  const d = Math.floor(diffMs / (24 * 60 * 60_000));
  return `${d}d ago`;
}

export function formatMwh(mwh: number | null): string {
  if (mwh == null) return "-";
  if (mwh >= 1000) return `${(mwh / 1000).toFixed(2)} Wh`;
  return `${mwh.toFixed(2)} mWh`;
}

export function formatCostPer1k(mwh: number | null, tariffPerKWh: number): string {
  const c = costPer1kUsd(mwh, tariffPerKWh);
  if (c == null) return "-";
  return `$${c.toFixed(2)}/1k`;
}
