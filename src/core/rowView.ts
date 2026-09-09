/**
 * Pure TreeView row composition: description text, 48h-trend tooltip row,
 * and the sparkline-vs-zap icon choice. ZERO vscode imports — the ThemeIcon
 * branches (star/zap) stay in treeProvider; this module returns raw SVG or null.
 *
 * Old-cache contract: every function here keys off sparkline presence, so a
 * pre-feature snapshot (field undefined) renders exactly the legacy output.
 */
import type { Sparkline48h, TrendInfo, ValuedQuote } from "./types";
import type { SeverityScale } from "./color";
import { basisToSvgUri } from "./color";
import { costPer1kUsd, formatMwh } from "./energy";
import { TREND_COLORS, trendArrow, sparklineCardSvg, sparklineIconSvg, sparklineDescriptionSuffix } from "./sparkline";
import { sparklineToPngBytes } from "./sparklinePng";

/**
 * Compose the tree-row description. Exact legacy shape when spark is absent:
 * `${formatMwh(mwh)} · $${cost.toFixed(2)}/1k`, or "-" when mwh is null.
 * With spark present, only the trend arrow + pct is appended (the lo/hi
 * range lives in the hover tooltip, not the row).
 */
export function modelRowDescription(
  mwh: number | null,
  cost: number | null,
  spark: Sparkline48h | null | undefined,
  trend: TrendInfo | null,
): string {
  const suffix = sparklineDescriptionSuffix(spark, trend);
  if (mwh != null) {
    return `${formatMwh(mwh)} · $${(cost ?? 0).toFixed(2)}/1k${suffix}`;
  }
  return suffix.trim() ? suffix.trim() : "-";
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
  // The SVG-base64 path is the fallback when the rasterizer returns null
  // (defense in depth — sparklineToPngBytes and sparklineCardSvg share the
  // same usability gate, so for a valid spark the PNG path always wins).
  const png = sparklineToPngBytes(spark);
  const src = png
    ? `data:image/png;base64,${png.toString("base64")}`
    : card
      ? `data:image/svg+xml;base64,${Buffer.from(card, "utf8").toString("base64")}`
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
  const rangePart =
    spark.minMwh != null && spark.maxMwh != null
      ? ` · lo ${formatMwh(spark.minMwh)} – hi ${formatMwh(spark.maxMwh)}`
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
  opts: { fetchedAt: string | null; isBest: boolean; pricingUrl: string; tariff: number },
): string {
  const mwh = v.descriptionMwh;
  const cost = costPer1kUsd(mwh, opts.tariff);
  const headerBase = `**${escapeMarkdownLocal(v.quote.displayName)}**  \n\`slug: ${escapeMarkdownLocal(v.quote.slug)}\``;
  const lines: string[] = [];
  lines.push(headerBase);
  if (opts.isBest) lines.push(`\n$(star-full) **Best value**`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  const rightNowStr = formatMwh(v.quote.rightNowMwh);
  const typicalStr = formatMwh(v.quote.typicalMwh);
  const basisStr = v.basisMwh != null ? formatMwh(v.basisMwh) : "—";
  lines.push(`| Right now | ${rightNowStr} |`);
  lines.push(`| Typical (7d) | ${typicalStr} |`);
  lines.push(`| Basis | ${basisStr} |`);
  if (cost != null && mwh != null) lines.push(`| Cost/1k | $${cost.toFixed(2)} |`);
  if (v.quote.trend) {
    const arrow = v.quote.trend.direction === "above" ? "▲" : v.quote.trend.direction === "below" ? "▼" : "—";
    lines.push(`| Trend | ${arrow} ${v.quote.trend.pct}% ${escapeMarkdownLocal(v.quote.trend.direction)} |`);
  }
  const sparkRow = sparklineTooltipRow(v.quote.sparkline, v.quote.slug);
  if (sparkRow) lines.push(sparkRow);
  if (v.quote.cachePct != null) lines.push(`| Cache | ${v.quote.cachePct}% |`);
  if (v.quote.contextBand) {
    lines.push(`| Context | ${escapeMarkdownLocal(v.quote.contextBand)} |`);
  }
  if (v.score) {
    lines.push(`| Score | ${v.score.performanceScore} (${escapeMarkdownLocal(v.score.source)}) |`);
  }
  if (v.value != null) lines.push(`| Value | ${v.value.toFixed(4)} (score/mWh) |`);
  else lines.push(`| Value | no benchmark |`);
  if (v.quote.bands.length > 0) {
    lines.push("");
    lines.push(`| Band | Energy | Share |`);
    lines.push(`|---|---|---|`);
    for (const b of v.quote.bands) {
      const em = b.mwh != null ? formatMwh(b.mwh) : "—";
      const s = b.sharePct != null ? `${b.sharePct.toFixed(1)}%` : "—";
      lines.push(`| ${escapeMarkdownLocal(b.band)} | ${em} | ${s} |`);
    }
  }
  if (opts.fetchedAt) lines.push(`\n_Last updated: ${escapeMarkdownLocal(opts.fetchedAt)}_`);
  lines.push(tooltipFooter(opts.pricingUrl, v.quote.slug));
  return lines.join("\n");
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
