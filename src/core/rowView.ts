/**
 * Pure TreeView row composition: description text, 48h-trend tooltip row,
 * and the sparkline-vs-zap icon choice. ZERO vscode imports — the ThemeIcon
 * branches (star/zap) stay in treeProvider; this module returns raw SVG or null.
 *
 * Old-cache contract: every function here keys off sparkline presence, so a
 * pre-feature snapshot (field undefined) renders exactly the legacy output.
 */
import type { SortOrder, Sparkline48h, SparklineDirection, TrendInfo, ValuedQuote } from "./types";
import type { FlexHoldBars, ModelPerfMetrics, P50P95, ThroughputSparkline } from "./perfMetrics";
import { boardTrendLabel, formatEnergy, formatEnergyRange, isContextBandText, pickUnit, rankBands, sameEnergy, textSparkline } from "./cardFormat";
import type { SeverityScale } from "./color";
import { basisToSvgUri } from "./color";
import { costPer1kUsd, formatMwh, humanizeAge } from "./energy";
import { TREND_COLORS, trendArrow, sparklineCardSvg, sparklineIconSvg, sparklineDescriptionSuffix } from "./sparkline";
import { sparklineToPngBytes } from "./sparklinePng";
import { formatThinkingLine } from "./thinking";
import type { ThinkingInfo } from "./thinking";

export function formatLatencyMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "\u2014";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function ttftDotColor(ms: number): string {
  if (ms < 300) return "#4ec9b0";
  if (ms < 1000) return "#dcdcaa";
  return "#ce9178";
}

export function sortBadgeLabel(order: SortOrder | undefined): string {
  if (order === "bangForBuck") return "Top Efficiency";
  if (order === "fastest") return "Speed Leader";
  if (order === "lowestPrice") return "Lowest Cost";
  return "Best value";
}

/**
 * Compose the tree-row description. Legacy shape when `opts?.sortOrder` is
 * omitted; otherwise wired to the active sort mode with `—` for missing metrics.
 */
export function modelRowDescription(
  mwh: number | null,
  cost: number | null,
  spark: Sparkline48h | null | undefined,
  trend: TrendInfo | null,
  opts?: { sortOrder?: SortOrder; perf?: ModelPerfMetrics | null; bangForBuck?: number | null },
): string {
  const suffix = sparklineDescriptionSuffix(spark, trend);
  const order = opts?.sortOrder;
  if (!order) {
    if (mwh != null) {
      return `${formatMwh(mwh)} · $${(cost ?? 0).toFixed(2)}/1k${suffix}`;
    }
    return suffix.trim() ? suffix.trim() : "-";
  }

  const energyStr = mwh != null ? formatMwh(mwh) : "\u2014";
  const tokP50 = opts.perf?.throughputToks?.p50 ?? null;
  const tokStr = tokP50 != null ? `${Math.round(tokP50)} tok/s` : "\u2014 tok/s";
  const ttftStr = formatLatencyMs(opts.perf?.firstTokenMs?.p50);

  if (order === "bangForBuck") {
    const ratioStr = opts.bangForBuck != null ? `${opts.bangForBuck.toFixed(1)} tok/s\u00b7mWh` : "\u2014 tok/s\u00b7mWh";
    return `${ratioStr} \u00b7 ${tokStr} \u00b7 ${energyStr}${suffix}`;
  }
  if (order === "fastest") {
    return `${tokStr} \u00b7 ${ttftStr} \u00b7 ${energyStr}${suffix}`;
  }
  const costStr = cost != null && mwh != null ? `$${cost.toFixed(2)}/1k` : "\u2014";
  return `${energyStr} \u00b7 ${costStr} \u00b7 ${tokStr}${suffix}`;
}

/**
 * Build the chart `<img>` tag for a sparkline directly from its data.
 * Powers the chart panel surfaces (400x104); the 200x52 default is kept
 * as a fallback size. The tag is always extension-generated from numeric
 * sparkline data, never parsed out of markdown that could contain
 * model-supplied content.
 * Returns null when the sparkline cannot produce an image.
 */
export function buildSparklineImgTag(
  spark: Sparkline48h | null | undefined,
  display?: { w: number; h: number },
): string | null {
  if (!spark) return null;
  const w = display?.w ?? 200;
  const h = display?.h ?? 52;
  const card = sparklineCardSvg(spark);
  // PNG form: VS Code blocks SVG images in TreeItem tooltip MarkdownStrings
  // (by design) but renders `data:image/png;base64` images. Base64 uses a
  // restricted alphabet, so the URI is table-safe by construction.
  // The URL-encoded SVG path is the fallback when the rasterizer returns null
  // (defense in depth — sparklineToPngBytes and sparklineCardSvg share the
  // same usability gate, so for a valid spark the PNG path always wins).
  const png = sparklineToPngBytes(spark);
  const src = png
    ? `data:image/png;base64,${png.toString("base64")}`
    : card
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(card).replace(/\(/g, "%28").replace(/\)/g, "%29")}`
      : null;
  return src ? `<img src="${src}" width="${w}" height="${h}"><br>` : null;
}

/**
 * The `| 48h trend | ... |` markdown table row for the hover tooltip:
 * colored trend text + lo/hi range, plus an `Open 48h chart` command link
 * that opens the reliable WebviewPanel chart surface.
 *
 * Deliberately NO `<img>`: hover image rendering proved unreliable (the
 * same PNG renders in a normal WebviewPanel but never in TreeItem hover),
 * and the base64 payload only fed the tooltip truncation risk.
 * Returns null when the sparkline is absent — the caller skips the push.
 * When slug is absent, the text row is kept but no chart link is appended.
 */
export function sparklineTooltipRow(spark: Sparkline48h | null | undefined, slug?: string | null): string | null {
  if (!spark) return null;
  const dirWord = spark.direction === "above" ? "above avg" : spark.direction === "below" ? "below avg" : "in line with avg";
  const unit = pickUnit(spark.minMwh, spark.maxMwh);
  const rangePart =
    spark.minMwh != null && spark.maxMwh != null
      ? ` · lo ${formatEnergy(spark.minMwh, unit)} – hi ${formatEnergy(spark.maxMwh, unit)}`
      : "";
  const text = `<span style="color:${TREND_COLORS[spark.direction]};">${trendArrow(spark.direction)} ${dirWord}</span>${rangePart}`;
  if (slug == null || slug === "") return `| 48h trend | ${text} |`;
  const arg = encodeCommandArg({ slug });
  return `| 48h trend | ${text} · [Open 48h chart](command:neuraldash.openModelChart?${arg}) |`;
}

/**
 * Pure model-row tooltip builder — the EXACT markdown string assigned to
 * `md.value` in the tree provider's toTreeItem (extracted for the
 * `neuraldash.debugTooltip` diagnostic so the captured evidence provably
 * comes from the live code path, not a re-implementation). ZERO vscode
 * imports; the caller wraps the string in a MarkdownString.
 *
 * @param v the valued row; tariff converts descriptionMwh → Cost/1k.
 * @param opts fetchedAt (the snapshot's `_Last updated_` line; null skips it),
 *   isBest (the `$(star-full) Best value` line), and pricingUrl (footer link).
 */
export function buildModelTooltipMd(
  v: ValuedQuote,
  opts: {
    fetchedAt: string | null;
    isBest: boolean;
    pricingUrl: string;
    tariff: number;
    now?: Date;
    thinking?: ThinkingInfo | null;
    sortOrder?: SortOrder;
  },
): string {
  const q = v.quote;
  const mwh = v.descriptionMwh;
  const cost = costPer1kUsd(mwh, opts.tariff);
  const lines: string[] = [];

  const boardTrend = boardTrendLabel(q.trend);
  const trendBadge = boardTrend
    ? ` · <span style="color:${TREND_COLORS[boardTrendDirection(q.trend)]};">${boardTrend}</span>`
    : "";
  lines.push(`**${escapeMarkdownLocal(q.displayName)}**${trendBadge}  \n\`${escapeMarkdownLocal(q.slug)}\``);
  if (opts.isBest) lines.push(`\n$(star-full) **${sortBadgeLabel(opts.sortOrder)}**`);
  lines.push("");

  // KPI Hero strip (3-col summary)
  const tok = v.perf?.throughputToks ?? null;
  const ttft = v.perf?.firstTokenMs ?? null;
  const cacheVal = v.perf?.cacheHitPct ?? q.cachePct ?? null;
  const energySub = [cost != null && mwh != null ? `$${cost.toFixed(2)}/1k` : null, q.typicalMwh != null ? `${formatEnergy(q.typicalMwh)} 7d` : null]
    .filter(Boolean)
    .join(" · ");
  const tokSub = [tok ? `p95 ${Math.round(tok.p95)}` : null, cacheVal != null ? `${cacheVal}%` : null]
    .filter(Boolean)
    .join(" · ");
  const ttftHead = ttft
    ? `<span style="color:${ttftDotColor(ttft.p50)};">\u25cf</span> **${formatLatencyMs(ttft.p50)}**`
    : "\u2014";
  const ttftSub = ttft ? `p95 ${formatLatencyMs(ttft.p95)}` : "\u2014";

  lines.push(`---`);
  lines.push(`| Energy | Throughput | First token |`);
  lines.push(`|:---|:---:|---:|`);
  lines.push(`| **${formatEnergy(q.rightNowMwh ?? q.typicalMwh)}** | ${tok ? `**${Math.round(tok.p50)} tok/s**` : "\u2014"} | ${ttftHead} |`);
  lines.push(`| ${energySub || "\u2014"} | ${tokSub || "\u2014"} | ${ttftSub} |`);
  lines.push(`---`);

  // Unified detail grid
  const detailRows: string[] = [];
  if (v.bangForBuck != null) {
    detailRows.push(`| Bang for Buck | **${v.bangForBuck.toFixed(2)} tok/s\u00b7mWh** |`);
  }
  if (v.basisMwh != null && !sameEnergy(v.basisMwh, q.typicalMwh)) {
    detailRows.push(`| Ranking basis | ${formatEnergy(v.basisMwh)} |`);
  }
  const energySpark = sparklineCardRow(q.sparkline, q.slug);
  if (energySpark) detailRows.push(energySpark);
  const perfSpark = throughputSparklineRow(v.perf?.throughputSparkline);
  if (perfSpark) detailRows.push(perfSpark);
  const { shown, hiddenCount } = rankBands(q.bands, 3);
  if (shown.length > 0) {
    const unit = pickUnit(...shown.map((b) => b.mwh));
    const bandSummary = shown
      .map((b) => {
        const energyPart = b.mwh != null ? ` · ${formatEnergy(b.mwh, unit)}` : "";
        return `${escapeMarkdownLocal(b.band)} (${b.sharePct.toFixed(0)}%${energyPart})`;
      })
      .join(" · ");
    detailRows.push(`| Top sizes | ${bandSummary}${hiddenCount > 0 ? ` · _+${hiddenCount} more_` : ""} |`);
  } else if (isContextBandText(q.contextBand)) {
    detailRows.push(`| Prompt size | ${escapeMarkdownLocal(q.contextBand!)} (typical) |`);
  }

  if (detailRows.length > 0) {
    lines.push("");
    lines.push(`| | |`);
    lines.push(`|---|---|`);
    lines.push(...detailRows);
  }

  if (v.score) {
    const parts = [`Score ${v.score.performanceScore} (${escapeMarkdownLocal(v.score.source)})`];
    if (v.value != null) parts.push(`${v.value.toFixed(4)} score/mWh`);
    lines.push("");
    lines.push(`**Benchmark** · ${parts.join(" · ")}`);
  }

  if (opts.thinking) lines.push("", formatThinkingLine(opts.thinking));

  if (opts.fetchedAt) {
    const age = humanizeAge(opts.fetchedAt, opts.now);
    lines.push(`\n_Updated ${escapeMarkdownLocal(age)} · ${escapeMarkdownLocal(sourceLabel(opts.pricingUrl))}_`);
  }
  lines.push(tooltipFooter(opts.pricingUrl, q.slug));
  return lines.join("\n");
}

const SPARK_LADDER = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];

export function flexHoldBarsToText(hold: FlexHoldBars | null | undefined, width = 16): string | null {
  if (!hold || hold.bars.length === 0) return null;
  const maxH = Math.max(...hold.bars.map((b) => b.height), 0);
  if (maxH <= 0) return SPARK_LADDER[0]!.repeat(width);
  const buckets = new Array<number>(width).fill(0);
  for (const b of hold.bars) {
    const idx = Math.min(width - 1, Math.max(0, Math.floor((b.x / 136) * width)));
    if (b.height > buckets[idx]!) buckets[idx] = b.height;
  }
  return buckets
    .map((h) => SPARK_LADDER[Math.min(7, Math.round((h / maxH) * 7))]!)
    .join("");
}

function throughputSparklineRow(spark: ThroughputSparkline | null | undefined): string | null {
  if (!spark) return null;
  const glyphs = textSparkline(spark.points);
  if (!glyphs) return null;
  const parts = ["48h"];
  if (spark.minToks != null && spark.maxToks != null) {
    parts.push(`${Math.round(spark.minToks)}\u2013${Math.round(spark.maxToks)} tok/s`);
  }
  if (spark.refY != null) {
    const lastY = spark.points[spark.points.length - 1]!.y;
    // SVG y=0 is top: smaller y means higher throughput.
    const above = lastY < spark.refY - 1;
    const below = lastY > spark.refY + 1;
    const color = above ? "#4ec9b0" : below ? "#ce9178" : "#8c8c8c";
    const label = above ? "\u25b2 above 7d" : below ? "\u25bc below 7d" : "\u2248 in line";
    parts.push(`<span style="color:${color};">${label}</span>`);
  }
  return `| ${glyphs} | ${parts.join(" \u00b7 ")} |`;
}

function boardTrendDirection(trend: TrendInfo | null): SparklineDirection {
  if (!trend || trend.direction === "inline") return "neutral";
  return trend.direction;
}

function sparklineCardRow(spark: Sparkline48h | null | undefined, slug: string): string | null {
  if (!spark) return null;
  const glyphs = textSparkline(spark.points) ?? "48h";
  const dirWord = spark.direction === "above" ? "above avg" : spark.direction === "below" ? "below avg" : "in line with avg";
  const parts = [`48h`];
  const range = formatEnergyRange(spark.minMwh, spark.maxMwh);
  if (range) parts.push(range);
  parts.push(`<span style="color:${TREND_COLORS[spark.direction]};">${trendArrow(spark.direction)} ${dirWord}</span>`);
  if (slug) parts.push(`[Open chart](command:neuraldash.openModelChart?${encodeCommandArg({ slug })})`);
  return `| ${glyphs} | ${parts.join(" · ")} |`;
}

export function sourceLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Tooltip markdown escaping, shared with treeProvider's flex rows.
 * Escapes markdown delimiters AND HTML delimiters: model-derived fields flow
 * into a TRUSTED MarkdownString (isTrusted=true for the footer command links),
 * so a raw `<` would let a hostile displayName inject real HTML into the
 * hover. Entities (`&lt;`) render as literal characters instead. `&` first.
 */
export function escapeMarkdownLocal(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Encode a `{slug}` command-link argument. encodeURIComponent alone leaves
 * `(` and `)` raw, and a raw `)` terminates the markdown link destination
 * early — force-encode the parentheses too.
 */
export function encodeCommandArg(arg: { slug: string }): string {
  return encodeURIComponent(JSON.stringify(arg)).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/**
 * Resolve the slug from a copySlug command argument. Markdown command links
 * pass args after `?` as URI-encoded JSON, and the parsed shape has varied
 * (spread object/array vs single value), so accept all three: a string, an
 * array whose first element is a string, or an object with a string `slug`.
 * Anything else (including an empty string) resolves to null.
 */
export function resolveSlugArg(arg: unknown): string | null {
  if (typeof arg === "string") return arg === "" ? null : arg;
  if (Array.isArray(arg)) return typeof arg[0] === "string" && arg[0] !== "" ? arg[0] : null;
  if (arg != null && typeof arg === "object" && typeof (arg as { slug?: unknown }).slug === "string") {
    const slug = (arg as { slug: string }).slug;
    return slug === "" ? null : slug;
  }
  return null;
}

/**
 * Resolve the model slug for the `neuraldash.openModelChart` command.
 * Extends resolveSlugArg with the TreeItem shape: context-menu / inline
 * button invocations pass the TreeItem, whose core-serialized string `.id`
 * carries the slug (item.id is set in treeProvider's toTreeItem).
 */
export function resolveModelRefArg(arg: unknown): string | null {
  const fromSlug = resolveSlugArg(arg);
  if (fromSlug) return fromSlug;
  if (arg != null && typeof arg === "object" && typeof (arg as { id?: unknown }).id === "string") {
    const id = (arg as { id: string }).id;
    return id === "" ? null : id;
  }
  return null;
}

/**
 * Footer line for the row hover tooltip: Copy Slug button on the left, then
 * the pricing-page link. The `](` link markers flip VS Code's hover widget to
 * interactive/sticky (hideOnHover=false), so the pointer can move into the
 * tooltip to use the links. Kept out of the table with a blank line so
 * it renders as a paragraph under it. When slug is absent, degrades to the
 * pricing link alone.
 */
export function tooltipFooter(pricingUrl: string, slug: string | null | undefined): string {
  const pricing = `[Open Pricing Page ↗](<${pricingUrl}>)`;
  if (slug == null || slug === "") return `\n\n${pricing}`;
  const arg = encodeCommandArg({ slug });
  return `\n\n[Copy Slug](command:neuraldash.copySlug?${arg}) · ${pricing}`;
}

/**
 * Pure part of the icon chain: sparkline SVG when usable, else the legacy
 * severity zap SVG. Star/zap ThemeIcon branches stay in treeProvider.
 * NOTE: currently UI-unused (tree icon reverted to the severity zap per user
 * feedback) — reserved for the future board surface.
 */
export function rowIconSvg(
  spark: Sparkline48h | null | undefined,
  basis: number | null,
  scale: SeverityScale,
): string {
  return sparklineIconSvg(spark, basis, scale) ?? basisToSvgUri(basis, scale);
}
