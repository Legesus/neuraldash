import type { BandEnergy, SparklinePoint, TrendInfo } from "./types";

export type EnergyUnit = "mWh" | "Wh";

const SPARK_GLYPHS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const BAR_GLYPH = "█";

export function pickUnit(...values: Array<number | null | undefined>): EnergyUnit {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (finite.length === 0) return "mWh";
  return Math.max(...finite) >= 1000 ? "Wh" : "mWh";
}

export function formatEnergy(mwh: number | null | undefined, unit: EnergyUnit = pickUnit(mwh)): string {
  if (mwh == null || !Number.isFinite(mwh)) return "—";
  return unit === "Wh" ? `${(mwh / 1000).toFixed(2)} Wh` : `${mwh.toFixed(2)} mWh`;
}

export function formatEnergyRange(lo: number | null | undefined, hi: number | null | undefined): string | null {
  if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const unit = pickUnit(lo, hi);
  const loText = formatEnergy(lo, unit).replace(/ (m?Wh)$/, "");
  return `${loText}–${formatEnergy(hi, unit)}`;
}

export function boardTrendLabel(trend: TrendInfo | null | undefined): string | null {
  if (!trend) return null;
  if (trend.direction === "inline") return "≈ in line with 7d";
  const arrow = trend.direction === "above" ? "▲" : "▼";
  return `${arrow} ${trend.pct}% vs 7d`;
}

export function textSparkline(points: SparklinePoint[] | null | undefined, width = 16): string | null {
  if (!points || points.length < 2 || width < 2) return null;
  const xs = points.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  if (!(maxX > minX)) return null;
  const heights = points.map((p) => -p.y);
  const lo = Math.min(...heights);
  const hi = Math.max(...heights);
  const span = hi - lo;
  let out = "";
  for (let i = 0; i < width; i++) {
    const x = minX + ((maxX - minX) * i) / (width - 1);
    const h = interpolate(points, x);
    const level = span > 0 ? Math.round(((-h - lo) / span) * (SPARK_GLYPHS.length - 1)) : Math.floor((SPARK_GLYPHS.length - 1) / 2);
    out += SPARK_GLYPHS[Math.max(0, Math.min(SPARK_GLYPHS.length - 1, level))];
  }
  return out;
}

function interpolate(points: SparklinePoint[], x: number): number {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (x <= b.x) {
      if (b.x === a.x) return b.y;
      const t = (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * Math.max(0, Math.min(1, t));
    }
  }
  return points[points.length - 1].y;
}

export interface RankedBand {
  band: string;
  mwh: number | null;
  sharePct: number;
  bar: string;
}

export function rankBands(bands: BandEnergy[], limit = 4, barWidth = 12): { shown: RankedBand[]; hiddenCount: number } {
  const usable = bands
    .filter((b): b is BandEnergy & { sharePct: number } => b.sharePct != null && b.sharePct > 0)
    .sort((a, b) => b.sharePct - a.sharePct);
  const maxShare = usable.length > 0 ? usable[0].sharePct : 0;
  const shown = usable.slice(0, limit).map((b) => ({
    band: b.band,
    mwh: b.mwh,
    sharePct: b.sharePct,
    bar: BAR_GLYPH.repeat(Math.max(1, Math.round((b.sharePct / maxShare) * barWidth))),
  }));
  return { shown, hiddenCount: usable.length - shown.length };
}

export function sameEnergy(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < 0.005;
}

export function isContextBandText(text: string | null | undefined): boolean {
  return text != null && /^\d+[kKmM]?\s*[-–—]\s*\d+[kKmM]?$/.test(text.trim());
}

export interface TierPrice {
  label: string;
  normal: number | null;
  flex: number | null;
  digits: number;
}

export function savingPct(normal: number | null, flex: number | null): number | null {
  if (normal == null || flex == null || !(normal > 0) || !Number.isFinite(flex)) return null;
  return ((normal - flex) / normal) * 100;
}

export function formatPrice(v: number | null, minDigits = 2, maxDigits = 4): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const trimmed = v.toFixed(maxDigits).replace(/0+$/, "");
  const decimals = Math.max(minDigits, trimmed.split(".")[1]?.length ?? 0);
  return `$${v.toFixed(decimals)}`;
}

export function tierComparisonTable(rows: TierPrice[]): string[] {
  const usable = rows.filter((r) => r.normal != null || r.flex != null);
  if (usable.length === 0) return [];
  const lines = [`| /1M tok | Normal | → Flex | Saving |`, `|---|---:|---:|---:|`];
  for (const r of usable) {
    const pct = savingPct(r.normal, r.flex);
    const saving = pct == null ? "—" : pct > 0 ? `**−${pct.toFixed(0)}%**` : `${(-pct).toFixed(0)}% more`;
    lines.push(`| ${r.label} | ${formatPrice(r.normal, r.digits)} | ${formatPrice(r.flex, r.digits)} | ${saving} |`);
  }
  return lines;
}

export function flexEnergyTable(
  consumedMwh: number | null | undefined,
  normalCostPer1k: number | null | undefined,
  multiplier: number | null | undefined,
): string[] {
  if (consumedMwh == null || !Number.isFinite(consumedMwh) || multiplier == null || !Number.isFinite(multiplier) || !(multiplier > 0)) return [];
  const chargedMwh = consumedMwh * multiplier;
  const unit = pickUnit(consumedMwh, chargedMwh);
  const pct = savingPct(consumedMwh, chargedMwh);
  const saving = pct == null ? "—" : pct > 0 ? `**−${pct.toFixed(0)}%**` : `${(-pct).toFixed(0)}% more`;
  const lines = [`| Energy / req | Normal | → Flex | Saving |`, `|---|---:|---:|---:|`];
  lines.push(`| Charged | ${formatEnergy(consumedMwh, unit)} | ${formatEnergy(chargedMwh, unit)} | ${saving} |`);
  if (normalCostPer1k != null && Number.isFinite(normalCostPer1k)) {
    lines.push(`| Cost / 1k req | ${formatPrice(normalCostPer1k, 2, 2)} | ${formatPrice(normalCostPer1k * multiplier, 2, 2)} | ${saving} |`);
  }
  return lines;
}
