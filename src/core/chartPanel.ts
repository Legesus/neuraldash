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
import type { Sparkline48h, SparklineDirection, TrendInfo, ValuedQuote } from "./types";
import type { FlexEntry } from "./flexCatalog";
import type { PerfMetricsDoc, ThroughputSparkline } from "./perfMetrics";
import { costPer1kUsd, humanizeAge } from "./energy";
import { boardTrendLabel, formatEnergy, formatPrice } from "./cardFormat";
import { buildTrendChartSvg, formatHoursAgo, summarizeTrend, TREND_CHART_CSS, type TrendSummary } from "./chartSvg";
import { TREND_COLORS, trendArrow } from "./sparkline";
import { formatLatencyMs, sourceLabel, ttftDotColor } from "./rowView";

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

export interface ChartTarget {
  valued: ValuedQuote;
  flex?: FlexEntry;
  linkedSlug?: string;
}

/**
 * Resolve either a standard board slug or a `flex:<slug>` key into a
 * ValuedQuote ready for `buildModelChartHtml`. For Flex entries, energy,
 * 48h sparkline bounds, cost/1k, and bangForBuck are scaled by `flexMultiplier`.
 */
export function findChartTarget(
  valued: readonly ValuedQuote[],
  flexEntries: readonly FlexEntry[],
  perfDoc: PerfMetricsDoc | null,
  slugOrKey: string,
): ChartTarget | null {
  if (!slugOrKey.startsWith("flex:")) {
    const hit = findModelBySlug([...valued], slugOrKey);
    return hit ? { valued: hit } : null;
  }
  const flexSlug = slugOrKey.slice(5);
  const entry = flexEntries.find((e) => e.slug === flexSlug);
  if (!entry) return null;
  const directBase = findModelBySlug([...valued], entry.baseSlug);
  const aliasTarget = !directBase
    ? perfDoc?.aliases?.[entry.baseSlug] ?? perfDoc?.aliases?.[entry.slug.replace(/-flex$/, "")]
    : undefined;
  const base = directBase ?? (aliasTarget ? findModelBySlug([...valued], aliasTarget) : null);
  const linkedSlug = aliasTarget && base ? aliasTarget : undefined;
  const mult = entry.flexMultiplier != null && entry.flexMultiplier > 0 ? entry.flexMultiplier : null;
  const scaleNum = (n: number | null | undefined): number | null =>
    n != null && Number.isFinite(n) ? (mult != null ? n * mult : n) : null;
  const baseSpark = base?.quote.sparkline ?? null;
  const scaledSpark: Sparkline48h | null = baseSpark
    ? {
        ...baseSpark,
        minMwh: scaleNum(baseSpark.minMwh),
        maxMwh: scaleNum(baseSpark.maxMwh),
      }
    : null;
  const flexPerf =
    perfDoc?.flex[entry.baseSlug] ??
    perfDoc?.flex[entry.slug] ??
    (linkedSlug ? perfDoc?.flex[linkedSlug] : undefined) ??
    null;
  const mergedPerf = base?.perf || flexPerf
    ? {
        slug: entry.slug,
        firstTokenMs: base?.perf?.firstTokenMs ?? null,
        throughputToks: base?.perf?.throughputToks ?? null,
        cacheHitPct: base?.perf?.cacheHitPct ?? null,
        throughputSparkline: base?.perf?.throughputSparkline ?? null,
        flexDispatchWaitMs: flexPerf?.flexDispatchWaitMs ?? null,
        flexHoldBars: flexPerf?.flexHoldBars ?? null,
      }
    : null;
  const bfb =
    base?.bangForBuck != null
      ? mult != null
        ? base.bangForBuck / mult
        : base.bangForBuck
      : null;

  return {
    flex: entry,
    ...(linkedSlug ? { linkedSlug } : {}),
    valued: {
      quote: {
        displayName: entry.name,
        slug: entry.slug,
        isPreview: entry.preview,
        contextBand: base?.quote.contextBand ?? null,
        cachePct: base?.quote.cachePct ?? null,
        rightNowMwh: scaleNum(base?.quote.rightNowMwh),
        typicalMwh: scaleNum(base?.quote.typicalMwh),
        trend: base?.quote.trend ?? null,
        sparkline: scaledSpark,
        bands: base?.quote.bands ?? [],
        capturedAt: base?.quote.capturedAt ?? new Date().toISOString(),
      },
      basisMwh: scaleNum(base?.basisMwh),
      descriptionMwh: scaleNum(base?.descriptionMwh),
      score: base?.score ?? null,
      value: base?.value != null && mult != null ? base.value / mult : (base?.value ?? null),
      costPer1kUsd: scaleNum(base?.costPer1kUsd),
      perf: mergedPerf,
      bangForBuck: bfb,
    },
  };
}

export interface ChartPanelOptions {
  fetchedAt: string | null;
  tariff: number;
  sourceUrl?: string | null;
  now?: Date;
  compact?: boolean;
  flex?: FlexEntry;
  linkedSlug?: string;
}

const PANEL_CSS =
  `*{box-sizing:border-box;}` +
  `body{font-family:var(--vscode-font-family,system-ui,sans-serif);padding:16px 20px;color:var(--vscode-foreground,#ccc);background:var(--vscode-editor-background,#1e1e1e);font-variant-numeric:tabular-nums;}` +
  `h2{margin:0 0 3px;font-size:1.25em;font-weight:600;text-wrap:balance;}p{margin:4px 0;}.meta{color:var(--vscode-descriptionForeground,#888);}` +
  `code{font-family:var(--vscode-editor-font-family,monospace);font-size:0.88em;background:rgba(128,128,128,0.16);padding:1px 5px;border-radius:3px;}` +
  `.head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:12px;}` +
  `.badge{font-size:0.82em;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(128,128,128,0.14);white-space:nowrap;}` +
  `.bento{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px;}` +
  `.kpi{background:var(--vscode-editorWidget-background,rgba(128,128,128,0.08));border:1px solid var(--vscode-widget-border,var(--vscode-panel-border,rgba(128,128,128,0.22)));border-radius:6px;padding:8px 10px;}` +
  `.kpi .k-label{font-size:0.78em;text-transform:uppercase;letter-spacing:0.04em;color:var(--vscode-descriptionForeground,#888);margin-bottom:2px;}` +
  `.kpi .k-val{font-size:1.2em;font-weight:600;line-height:1.25;}` +
  `.kpi .k-sub{font-size:0.82em;color:var(--vscode-descriptionForeground,#888);margin-top:2px;}` +
  `.chart-card{background:var(--vscode-editorWidget-background,rgba(128,128,128,0.08));border:1px solid var(--vscode-widget-border,var(--vscode-panel-border,rgba(128,128,128,0.22)));border-radius:6px;padding:8px 10px;margin-bottom:10px;}` +
  `.chart-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:4px;font-size:0.88em;}` +
  `.chart-head b{font-weight:600;}` +
  `.stats{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:6px;padding-top:6px;border-top:1px solid rgba(128,128,128,0.14);font-size:0.84em;}.stats b{font-weight:600;}` +
  TREND_CHART_CSS;

const COMPACT_CSS =
  `body{padding:8px 12px;background:transparent;}h2{font-size:1.08em;}` +
  `.head{margin-bottom:8px;}.bento{gap:6px;margin-bottom:8px;}.kpi{padding:6px 8px;}.kpi .k-val{font-size:1.08em;}` +
  `.chart-card{padding:6px 8px;margin-bottom:8px;}.stats{gap:4px 12px;}`;

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">`;

export function buildChartPlaceholderHtml(message: string): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8">${CSP_META}<style>${PANEL_CSS}${COMPACT_CSS}</style></head>` +
    `<body><p class="meta">${escapeHtml(message)}</p></body></html>`
  );
}

function directionWord(dir: SparklineDirection): string {
  return dir === "above" ? "above 48h avg" : dir === "below" ? "below 48h avg" : "in line with 48h avg";
}

function boardTrendColor(trend: TrendInfo | null): string {
  if (!trend || trend.direction === "inline") return TREND_COLORS.neutral;
  return TREND_COLORS[trend.direction];
}

function formatStatsStrip(summary: TrendSummary | null, fmt: (val: number) => string): string {
  if (!summary) return "";
  return (
    `<div class="stats"><span>Low <b>${fmt(summary.low.mwh)}</b> <span class="meta">${formatHoursAgo(summary.low.hoursAgo)}</span></span>` +
    `<span>Median <b>${fmt(summary.median)}</b></span>` +
    `<span>High <b>${fmt(summary.high.mwh)}</b> <span class="meta">${formatHoursAgo(summary.high.hoursAgo)}</span></span>` +
    `<span class="meta">${summary.samples.length} samples</span></div>`
  );
}

function throughputChartInput(spark: ThroughputSparkline): { spark: Sparkline48h; color: string; arrowLabel: string | null } {
  let color = TREND_COLORS.neutral;
  let arrowLabel: string | null = null;
  if (spark.refY != null && spark.points.length > 0) {
    const lastY = spark.points[spark.points.length - 1]!.y;
    // SVG y=0 is top: smaller y means higher throughput.
    if (lastY < spark.refY - 1) {
      color = TREND_COLORS.below; // teal/green
      arrowLabel = "\u25b2 above 7d";
    } else if (lastY > spark.refY + 1) {
      color = TREND_COLORS.above; // amber/orange
      arrowLabel = "\u25bc below 7d";
    } else {
      arrowLabel = "\u2248 in line with 7d";
    }
  }
  return {
    spark: {
      points: spark.points,
      refY: spark.refY,
      direction: "neutral",
      minMwh: spark.minToks,
      maxMwh: spark.maxToks,
    },
    color,
    arrowLabel,
  };
}

function kpiCard(label: string, val: string, sub?: string): string {
  return (
    `<div class="kpi">` +
    `<div class="k-label">${label}</div>` +
    `<div class="k-val">${val}</div>` +
    (sub ? `<div class="k-sub">${sub}</div>` : "") +
    `</div>`
  );
}

export function buildModelChartHtml(v: ValuedQuote, opts: ChartPanelOptions): string {
  const q = v.quote;
  const spark = q.sparkline ?? null;
  const summary = summarizeTrend(spark);

  const boardTrend = boardTrendLabel(q.trend);
  const flexBadge = opts.flex?.flexMultiplier != null ? `${opts.flex.flexMultiplier}\u00d7 Flex` : opts.flex ? "Flex" : null;
  const badgeHtml = flexBadge
    ? `<span class="badge" style="color:${TREND_COLORS.below};">${escapeHtml(flexBadge)}</span>`
    : boardTrend
      ? `<span class="badge" style="color:${boardTrendColor(q.trend)};">${escapeHtml(boardTrend)}</span>`
      : "";

  const cost = costPer1kUsd(v.descriptionMwh, opts.tariff);
  const cacheVal = v.perf?.cacheHitPct ?? q.cachePct ?? null;

  const kpis: string[] = [];
  const energyDirKey =
    q.trend && q.trend.direction !== "inline"
      ? q.trend.direction
      : spark && spark.direction !== "neutral"
        ? spark.direction
        : null;
  const energyColor = energyDirKey ? TREND_COLORS[energyDirKey] : null;
  const energyText = formatEnergy(q.rightNowMwh ?? q.typicalMwh);
  const energyVal = energyColor ? `<span style="color:${energyColor};">${energyText}</span>` : energyText;
  const energySub = [
    cost != null && v.descriptionMwh != null ? `$${cost.toFixed(2)}/1k` : null,
    q.typicalMwh != null ? `${formatEnergy(q.typicalMwh)} 7d` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  kpis.push(kpiCard(opts.flex ? "Charged Energy" : "Energy", energyVal, energySub || "right now"));

  if (opts.flex && opts.flex.inputPerMillion != null && opts.flex.outputPerMillion != null) {
    const std = opts.flex.standard;
    const normSub = std?.inputPerMillion != null && std?.outputPerMillion != null
      ? `Normal ${formatPrice(std.inputPerMillion, 2, 2)} / ${formatPrice(std.outputPerMillion, 2, 2)}`
      : "1M tokens";
    kpis.push(
      kpiCard(
        "Flex Price (1M)",
        `${formatPrice(opts.flex.inputPerMillion, 2, 2)} / ${formatPrice(opts.flex.outputPerMillion, 2, 2)}`,
        normSub,
      ),
    );
  }

  const tpInfo = v.perf?.throughputSparkline ? throughputChartInput(v.perf.throughputSparkline) : null;
  if (v.perf?.throughputToks) {
    const t = v.perf.throughputToks;
    const tpText = `${Math.round(t.p50)} tok/s`;
    const tpColor = tpInfo && tpInfo.color !== TREND_COLORS.neutral ? tpInfo.color : null;
    const tpVal = tpColor ? `<span style="color:${tpColor};">${tpText}</span>` : tpText;
    kpis.push(kpiCard("Throughput", tpVal, `p95 ${Math.round(t.p95)} tok/s`));
  }
  if (opts.flex && v.perf?.flexDispatchWaitMs) {
    const w = v.perf.flexDispatchWaitMs;
    kpis.push(
      kpiCard(
        "Dispatch Wait",
        `<span style="color:${ttftDotColor(w.p50)};">\u25cf</span> ${formatLatencyMs(w.p50)}`,
        `p95 ${formatLatencyMs(w.p95)}`,
      ),
    );
  } else if (v.perf?.firstTokenMs) {
    const f = v.perf.firstTokenMs;
    kpis.push(
      kpiCard(
        "First Token",
        `<span style="color:${ttftDotColor(f.p50)};">\u25cf</span> ${formatLatencyMs(f.p50)}`,
        `p95 ${formatLatencyMs(f.p95)}`,
      ),
    );
  }
  if (v.bangForBuck != null || cacheVal != null) {
    const val = v.bangForBuck != null ? `${v.bangForBuck.toFixed(2)} <span class="meta" style="font-size:0.65em;font-weight:400;">tok/s\u00b7mWh</span>` : `${cacheVal}%`;
    const sub = v.bangForBuck != null ? (cacheVal != null ? `${cacheVal}% cache hit` : undefined) : "cache hit";
    kpis.push(kpiCard(v.bangForBuck != null ? "Bang for Buck" : "Cache Hit", val, sub));
  }

  const chartSize = opts.compact ? { width: 420, height: 220 } : {};
  const energySvg = buildTrendChartSvg(spark, { ...chartSize, typicalMwh: q.typicalMwh });
  const energyDir = spark
    ? `<span style="color:${TREND_COLORS[spark.direction]};">${trendArrow(spark.direction)} ${directionWord(spark.direction)}</span>`
    : "";
  const energyCard = energySvg
    ? `<div class="chart-card"><div class="chart-head"><b>48h Energy</b>${energyDir}</div>` +
      energySvg +
      formatStatsStrip(summary, (n) => formatEnergy(n)) +
      `</div>`
    : `<div class="chart-card"><p class="meta">No 48h trend data available for this model.</p></div>`;

  let perfCard = "";
  if (tpInfo) {
    const { spark: tpSpark, color, arrowLabel } = tpInfo;
    const fmtToks = (n: number) => `${Math.round(n)} tok/s`;
    const tpChart = buildTrendChartSvg(tpSpark, {
      ...chartSize,
      formatValue: fmtToks,
      color,
      avgLabel: "7d p50",
      ariaLabel: "48 hour throughput trend",
    });
    if (tpChart) {
      const tpSummary = summarizeTrend(tpSpark);
      const badge = arrowLabel ? `<span style="color:${color};">${arrowLabel}</span>` : "";
      perfCard =
        `<div class="chart-card"><div class="chart-head"><b>48h Throughput</b>${badge}</div>` +
        tpChart +
        formatStatsStrip(tpSummary, fmtToks) +
        `</div>`;
    }
  }

  const footerParts: string[] = [];
  if (opts.fetchedAt) footerParts.push(`Updated ${escapeHtml(humanizeAge(opts.fetchedAt, opts.now))}`);
  if (opts.sourceUrl) footerParts.push(escapeHtml(sourceLabel(opts.sourceUrl)));
  if (v.perf) footerParts.push("?view=performance");
  if (opts.fetchedAt) footerParts.push(escapeHtml(opts.fetchedAt));
  const footer = footerParts.length > 0 ? `<p class="meta" style="font-size:0.82em;">${footerParts.join(" · ")}</p>` : "";

  const slugHtml = opts.linkedSlug
    ? `<code>${escapeHtml(q.slug)}</code> <span class="meta">\u2192</span> <code>${escapeHtml(opts.linkedSlug)}</code>`
    : `<code>${escapeHtml(q.slug)}</code>`;

  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8">${CSP_META}` +
    `<style>${PANEL_CSS}${opts.compact ? COMPACT_CSS : ""}</style>` +
    `</head><body>` +
    `<div class="head"><div><h2>${escapeHtml(q.displayName)}</h2>${slugHtml}</div>${badgeHtml}</div>` +
    `<div class="bento">${kpis.join("")}</div>` +
    energyCard +
    perfCard +
    footer +
    `</body></html>`
  );
}
