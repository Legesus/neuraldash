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
import type { SparklineDirection, TrendInfo, ValuedQuote } from "./types";
import { costPer1kUsd, humanizeAge } from "./energy";
import { boardTrendLabel, formatEnergy } from "./cardFormat";
import { buildTrendChartSvg, formatHoursAgo, summarizeTrend, TREND_CHART_CSS } from "./chartSvg";
import { TREND_COLORS, trendArrow } from "./sparkline";
import { sourceLabel } from "./rowView";

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
  fetchedAt: string | null;
  tariff: number;
  sourceUrl?: string | null;
  now?: Date;
}

const PANEL_CSS =
  `body{font-family:var(--vscode-font-family,system-ui,sans-serif);padding:16px 20px;color:var(--vscode-foreground,#ccc);background:var(--vscode-editor-background,#1e1e1e);}` +
  `h2{margin:0;font-size:1.3em;}p{margin:4px 0;}.meta{color:var(--vscode-descriptionForeground,#888);}` +
  `.headline{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:baseline;margin:12px 0 16px;}` +
  `.headline .now{font-size:1.6em;font-weight:600;}` +
  `.stats{display:flex;flex-wrap:wrap;gap:6px 24px;margin:12px 0;}.stats b{font-weight:600;}` +
  TREND_CHART_CSS;

function directionWord(dir: SparklineDirection): string {
  return dir === "above" ? "above 48h avg" : dir === "below" ? "below 48h avg" : "in line with 48h avg";
}

function boardTrendColor(trend: TrendInfo | null): string {
  if (!trend || trend.direction === "inline") return TREND_COLORS.neutral;
  return TREND_COLORS[trend.direction];
}

export function buildModelChartHtml(v: ValuedQuote, opts: ChartPanelOptions): string {
  const q = v.quote;
  const spark = q.sparkline ?? null;
  const summary = summarizeTrend(spark);

  const headline: string[] = [`<span class="now">${formatEnergy(q.rightNowMwh)}</span><span class="meta">right now</span>`];
  const boardTrend = boardTrendLabel(q.trend);
  if (boardTrend) headline.push(`<span style="color:${boardTrendColor(q.trend)};font-weight:600;">${escapeHtml(boardTrend)}</span>`);
  headline.push(`<span>${formatEnergy(q.typicalMwh)} <span class="meta">7d typical</span></span>`);
  if (spark) headline.push(`<span style="color:${TREND_COLORS[spark.direction]};">${trendArrow(spark.direction)} ${directionWord(spark.direction)}</span>`);
  const cost = costPer1kUsd(v.descriptionMwh, opts.tariff);
  if (cost != null && v.descriptionMwh != null) headline.push(`<span>$${cost.toFixed(2)} <span class="meta">/1k requests</span></span>`);
  if (q.cachePct != null) headline.push(`<span>${q.cachePct}% <span class="meta">cache</span></span>`);

  const chart = buildTrendChartSvg(spark, { typicalMwh: q.typicalMwh }) ?? `<p>No 48h trend data available for this model.</p>`;

  const stats = summary
    ? `<div class="stats"><span>Low <b>${formatEnergy(summary.low.mwh)}</b> <span class="meta">${formatHoursAgo(summary.low.hoursAgo)}</span></span>` +
      `<span>Median <b>${formatEnergy(summary.median)}</b></span>` +
      `<span>High <b>${formatEnergy(summary.high.mwh)}</b> <span class="meta">${formatHoursAgo(summary.high.hoursAgo)}</span></span>` +
      `<span class="meta">${summary.samples.length} samples</span></div>`
    : "";

  const footerParts: string[] = [];
  if (opts.fetchedAt) footerParts.push(`Updated ${escapeHtml(humanizeAge(opts.fetchedAt, opts.now))}`);
  if (opts.sourceUrl) footerParts.push(escapeHtml(sourceLabel(opts.sourceUrl)));
  if (opts.fetchedAt) footerParts.push(escapeHtml(opts.fetchedAt));
  const footer = footerParts.length > 0 ? `<p class="meta">${footerParts.join(" · ")}</p>` : "";

  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">` +
    `<style>${PANEL_CSS}</style>` +
    `</head><body>` +
    `<h2>${escapeHtml(q.displayName)}</h2>` +
    `<p class="meta"><code>${escapeHtml(q.slug)}</code></p>` +
    `<div class="headline">${headline.join("")}</div>` +
    chart +
    stats +
    footer +
    `</body></html>`
  );
}
