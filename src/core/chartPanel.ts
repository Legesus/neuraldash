/**
 * Pure chart-panel builder for the `neuraldash.openModelChart` WebviewPanel.
 * ZERO vscode imports — fully unit-testable under plain node:test.
 *
 * Surface contract: the panel is the reliable chart surface (the TreeItem
 * hover tooltip is text-only — hover image rendering proved unreliable).
 * All model-derived strings pass through `escapeHtml` at this single
 * boundary; the chart `<img>` is generated exclusively from numeric
 * sparkline data by the existing pure builders (base64 alphabet).
 */
import type { ValuedQuote } from "./types";
import { costPer1kUsd, formatMwh } from "./energy";
import { TREND_COLORS, trendArrow } from "./sparkline";
import { buildSparklineImgTag } from "./rowView";

/** Local HTML escaper (same 3-replace shape as the extension.ts helper). */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Find a board row by slug (the openModelChart command arg is an opaque
 * lookup key — the handler renders ONLY from the looked-up row, never from
 * the arg). Returns null on miss, including an empty board.
 */
export function findModelBySlug(valued: ValuedQuote[], slug: string): ValuedQuote | null {
  for (const v of valued) {
    if (v.quote.slug === slug) return v;
  }
  return null;
}

export interface ChartPanelOptions {
  /** Snapshot fetchedAt for the `_Last updated_` line; null skips it. */
  fetchedAt: string | null;
  /** Tariff for the Cost/1k stat. */
  tariff: number;
}

/**
 * Assemble the full WebviewPanel document for one model row: identity
 * header, colored trend line + lo/hi range + stats, the 400x104 PNG chart
 * (or an honest no-data message), and the fetched-at footer.
 * CSP is `default-src 'none'` with `img-src data:` only; no scripts.
 */
export function buildModelChartHtml(v: ValuedQuote, opts: ChartPanelOptions): string {
  const spark = v.quote.sparkline;
  const dir = spark?.direction ?? "neutral";
  const dirWord = dir === "above" ? "above avg" : dir === "below" ? "below avg" : "in line with avg";
  const rangePart =
    spark != null && spark.minMwh != null && spark.maxMwh != null
      ? ` · lo ${formatMwh(spark.minMwh)} – hi ${formatMwh(spark.maxMwh)}`
      : "";
  const stats: string[] = [`Right now ${formatMwh(v.quote.rightNowMwh)}`, `Typical (7d) ${formatMwh(v.quote.typicalMwh)}`];
  const cost = costPer1kUsd(v.descriptionMwh, opts.tariff);
  if (cost != null && v.descriptionMwh != null) stats.push(`Cost/1k $${cost.toFixed(2)}`);
  const img = buildSparklineImgTag(spark, { w: 400, h: 104 }) ?? `<p>No 48h trend data available for this model.</p>`;
  const fetched = opts.fetchedAt ? `<p class="meta">Last updated: ${escapeHtml(opts.fetchedAt)}</p>` : "";
  return (
    `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">` +
    `<style>body{font-family:var(--font-family,system-ui,sans-serif);padding:12px;color:var(--vscode-foreground,#ccc);` +
    `background:var(--vscode-editor-background,#1e1e1e);}h3{margin:0 0 4px;}p{margin:4px 0;}.meta{color:var(--vscode-descriptionForeground,#888);}</style>` +
    `</head><body>` +
    `<h3>${escapeHtml(v.quote.displayName)}</h3>` +
    `<p class="meta"><code>slug: ${escapeHtml(v.quote.slug)}</code></p>` +
    `<p><span style="color:${TREND_COLORS[dir]};font-weight:600;">${trendArrow(dir)} ${dirWord}</span>${rangePart} · ${stats.join(" · ")}</p>` +
    `${img}` +
    `${fetched}` +
    `</body></html>`
  );
}
