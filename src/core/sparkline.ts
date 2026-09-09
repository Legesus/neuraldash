/**
 * Pure 48h-sparkline renderer: geometry, colors, and description text.
 * ZERO vscode imports — fully unit-testable under plain node:test.
 */
import type { Sparkline48h, SparklineDirection, TrendInfo } from "./types";
import { severityColor, severityOf, type SeverityScale } from "./color";

/** Trend colors (Tailwind 400-shades): below avg = emerald, above avg = rose, neutral = grey. */
export const TREND_COLORS: Record<SparklineDirection, string> = {
  below: "#34d399",
  above: "#fb7185",
  neutral: "#9ca3af",
};

/** Trend arrow glyph per direction. */
export function trendArrow(direction: SparklineDirection): string {
  if (direction === "above") return "▲";
  if (direction === "below") return "▼";
  return "•";
}

/** Round to 2 decimals for deterministic SVG output. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Render a 16x16 sparkline icon SVG with a composed severity dot.
 * Returns null when the sparkline is absent/unusable (the old-cache gate:
 * pre-feature cached snapshots lack the field entirely).
 */
export function sparklineIconSvg(
  spark: Sparkline48h | null | undefined,
  basis: number | null,
  scale: SeverityScale,
): string | null {
  if (!spark || !Array.isArray(spark.points) || spark.points.length < 2) return null;
  const pts: string[] = [];
  for (const p of spark.points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    pts.push(`${round2(p.x * 0.16)},${round2(2 + p.y * 0.4)}`);
  }

  let refline = "";
  if (spark.refY != null && Number.isFinite(spark.refY)) {
    const y = round2(2 + spark.refY * 0.4);
    refline = `<line x1="0" y1="${y}" x2="16" y2="${y}" stroke="#9ca3af" stroke-width="0.5" stroke-dasharray="1,1" opacity="0.6"/>`;
  }

  const color = TREND_COLORS[spark.direction] ?? TREND_COLORS.neutral;
  const dot =
    basis == null || !Number.isFinite(basis) || basis <= 0 ? "#808080" : severityColor(severityOf(basis, scale));

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">` +
    refline +
    `<polyline fill="none" stroke="${color}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(" ")}"/>` +
    `<circle cx="2.5" cy="13.5" r="1.5" fill="${dot}"/>` +
    `</svg>`
  );
}

/**
 * Render a full-size 48h trend chart SVG for chart surfaces, at the
 * site's own source geometry (100x30 viewBox, stretches like the site's).
 * Single emphasis dot on the LAST point ("now"); no severity dot, no
 * per-point circles. Returns null when the sparkline is absent/unusable.
 */
export function sparklineCardSvg(spark: Sparkline48h | null | undefined): string | null {
  if (!spark || !Array.isArray(spark.points) || spark.points.length < 2) return null;
  const pts: string[] = [];
  for (const p of spark.points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    pts.push(`${round2(p.x)},${round2(p.y)}`);
  }

  let refline = "";
  if (spark.refY != null && Number.isFinite(spark.refY)) {
    const y = round2(spark.refY);
    refline =
      `<line x1="0" y1="${y}" x2="100" y2="${y}" stroke="#9ca3af" ` +
      `stroke-width="1" stroke-dasharray="2,2" opacity="0.6"/>`;
  }

  const color = TREND_COLORS[spark.direction] ?? TREND_COLORS.neutral;
  const last = spark.points[spark.points.length - 1];

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30" preserveAspectRatio="none">` +
    refline +
    `<polyline fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(" ")}"/>` +
    `<circle cx="${round2(last.x)}" cy="${round2(last.y)}" r="1.2" fill="${color}"/>` +
    `</svg>`
  );
}

/**
 * Description suffix for a tree row: ` · ▲47%` (trend arrow + pct only —
 * the lo/hi range lives in the hover tooltip, not the row).
 * Returns "" whenever the sparkline is absent — the old-cache gate.
 */
export function sparklineDescriptionSuffix(
  spark: Sparkline48h | null | undefined,
  trend: TrendInfo | null | undefined,
): string {
  if (!spark || !trend) return "";
  const arrow = trend.direction === "above" ? "▲" : trend.direction === "below" ? "▼" : "—";
  return ` · ${arrow}${trend.pct}%`;
}
