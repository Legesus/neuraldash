import type { Sparkline48h, SparklinePoint } from "./types";
import { TREND_COLORS } from "./sparkline";
import { formatEnergy, pickUnit } from "./cardFormat";

export const TREND_WINDOW_HOURS = 48;

export interface TrendSample {
  hoursAgo: number;
  mwh: number;
}

export interface TrendSummary {
  samples: TrendSample[];
  low: TrendSample;
  high: TrendSample;
  median: number;
  avgMwh: number | null;
}

export interface TrendChartOptions {
  width?: number;
  height?: number;
  typicalMwh?: number | null;
}

function usablePoints(spark: Sparkline48h | null | undefined): SparklinePoint[] | null {
  if (!spark || spark.points.length < 2) return null;
  const xs = spark.points.map((p) => p.x);
  return Math.max(...xs) > Math.min(...xs) ? spark.points : null;
}

export function valueScale(spark: Sparkline48h): ((y: number) => number) | null {
  const points = usablePoints(spark);
  if (!points || spark.minMwh == null || spark.maxMwh == null) return null;
  const ys = points.map((p) => p.y);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const lo = spark.minMwh;
  const hi = spark.maxMwh;
  if (!(bottom > top)) return () => (lo + hi) / 2;
  return (y) => lo + ((hi - lo) * (bottom - y)) / (bottom - top);
}

export function summarizeTrend(spark: Sparkline48h | null | undefined): TrendSummary | null {
  const points = usablePoints(spark);
  const toMwh = spark ? valueScale(spark) : null;
  if (!points || !spark || !toMwh) return null;
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const samples = points.map((p) => ({
    hoursAgo: TREND_WINDOW_HOURS * (1 - (p.x - minX) / (maxX - minX)),
    mwh: toMwh(p.y),
  }));
  const sorted = samples.map((s) => s.mwh).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const low = samples.reduce((a, b) => (b.mwh < a.mwh ? b : a));
  const high = samples.reduce((a, b) => (b.mwh > a.mwh ? b : a));
  const avgMwh = spark.refY != null ? toMwh(spark.refY) : null;
  return { samples, low, high, median, avgMwh };
}

export function formatHoursAgo(hoursAgo: number): string {
  const h = Math.round(hoursAgo);
  return h <= 0 ? "now" : `${h}h ago`;
}

function num(n: number): string {
  return Number(n.toFixed(2)).toString();
}

export function buildTrendChartSvg(spark: Sparkline48h | null | undefined, opts: TrendChartOptions = {}): string | null {
  const summary = summarizeTrend(spark);
  if (!summary || !spark) return null;
  const width = opts.width ?? 720;
  const height = opts.height ?? 240;
  const pad = { left: 72, right: 112, top: 16, bottom: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const typical = opts.typicalMwh != null && Number.isFinite(opts.typicalMwh) ? opts.typicalMwh : null;
  const domainValues = [summary.low.mwh, summary.high.mwh, ...(typical != null ? [typical] : [])];
  let dLo = Math.min(...domainValues);
  let dHi = Math.max(...domainValues);
  const span = dHi - dLo || Math.max(Math.abs(dHi), 1) * 0.1;
  dLo = Math.max(0, dLo - span * 0.08);
  dHi = dHi + span * 0.08;
  const unit = pickUnit(dLo, dHi);

  const xOf = (hoursAgo: number) => pad.left + plotW * (1 - hoursAgo / TREND_WINDOW_HOURS);
  const yOf = (mwh: number) => pad.top + plotH * (1 - (mwh - dLo) / (dHi - dLo));

  const color = TREND_COLORS[spark.direction] ?? TREND_COLORS.neutral;
  const parts: string[] = [];
  parts.push(
    `<svg class="trend-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="48 hour energy trend">`,
  );

  for (let i = 0; i <= 3; i++) {
    const v = dLo + ((dHi - dLo) * i) / 3;
    const y = yOf(v);
    parts.push(`<line class="grid" x1="${pad.left}" y1="${num(y)}" x2="${pad.left + plotW}" y2="${num(y)}"/>`);
    parts.push(`<text class="axis" x="${pad.left - 8}" y="${num(y + 4)}" text-anchor="end">${formatEnergy(v, unit)}</text>`);
  }
  for (const h of [48, 36, 24, 12, 0]) {
    const x = xOf(h);
    parts.push(`<text class="axis" x="${num(x)}" y="${height - 8}" text-anchor="middle">${h === 0 ? "now" : `-${h}h`}</text>`);
  }

  const refLine = (mwh: number, label: string, cls: string) => {
    const y = yOf(mwh);
    parts.push(`<line class="${cls}" x1="${pad.left}" y1="${num(y)}" x2="${pad.left + plotW}" y2="${num(y)}"/>`);
    parts.push(`<text class="${cls}-label" x="${pad.left + plotW + 6}" y="${num(y + 4)}">${label} ${formatEnergy(mwh, unit)}</text>`);
  };
  if (typical != null) refLine(typical, "7d", "ref-typical");
  if (summary.avgMwh != null) refLine(summary.avgMwh, "48h avg", "ref-avg");

  const path = summary.samples.map((s) => `${num(xOf(s.hoursAgo))},${num(yOf(s.mwh))}`).join(" ");
  parts.push(`<polyline class="trend-line" fill="none" stroke="${color}" points="${path}"/>`);

  for (const s of summary.samples) {
    parts.push(
      `<circle class="pt" cx="${num(xOf(s.hoursAgo))}" cy="${num(yOf(s.mwh))}" r="4" fill="${color}"><title>${formatHoursAgo(s.hoursAgo)} · ${formatEnergy(s.mwh)}</title></circle>`,
    );
  }

  const marker = (s: TrendSample, label: string, cls: string, dy: number) => {
    const x = xOf(s.hoursAgo);
    const y = yOf(s.mwh);
    parts.push(`<circle class="${cls}" cx="${num(x)}" cy="${num(y)}" r="4.5" fill="${color}"/>`);
    const anchor = x > pad.left + plotW * 0.85 ? "end" : x < pad.left + plotW * 0.15 ? "start" : "middle";
    parts.push(`<text class="marker-label" x="${num(x)}" y="${num(y + dy)}" text-anchor="${anchor}">${label} ${formatEnergy(s.mwh)}</text>`);
  };
  marker(summary.high, "hi", "marker", -10);
  if (summary.low !== summary.high) marker(summary.low, "lo", "marker", 18);
  const last = summary.samples[summary.samples.length - 1];
  parts.push(`<circle class="now" cx="${num(xOf(last.hoursAgo))}" cy="${num(yOf(last.mwh))}" r="5.5" fill="${color}"/>`);

  parts.push(`</svg>`);
  return parts.join("");
}

export const TREND_CHART_CSS =
  `.trend-chart{display:block;max-width:960px;font-family:var(--vscode-font-family,system-ui,sans-serif);}` +
  `.trend-chart .grid{stroke:var(--vscode-editorWidget-border,#444);stroke-width:1;opacity:.5;}` +
  `.trend-chart .axis{fill:var(--vscode-descriptionForeground,#888);font-size:11px;}` +
  `.trend-chart .trend-line{stroke-width:2;stroke-linejoin:round;stroke-linecap:round;}` +
  `.trend-chart .ref-typical{stroke:var(--vscode-foreground,#ccc);stroke-width:1;stroke-dasharray:6 4;opacity:.7;}` +
  `.trend-chart .ref-avg{stroke:var(--vscode-descriptionForeground,#888);stroke-width:1;stroke-dasharray:2 3;}` +
  `.trend-chart .ref-typical-label,.trend-chart .ref-avg-label{fill:var(--vscode-descriptionForeground,#888);font-size:11px;}` +
  `.trend-chart .pt{opacity:0;}.trend-chart .pt:hover{opacity:1;}` +
  `.trend-chart .now{stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:2;}` +
  `.trend-chart .marker-label{fill:var(--vscode-foreground,#ccc);font-size:11px;}`;
