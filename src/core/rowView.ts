/**
 * Pure TreeView row composition: description text, 48h-trend tooltip row,
 * and the sparkline-vs-zap icon choice. ZERO vscode imports — the ThemeIcon
 * branches (star/zap) stay in treeProvider; this module returns raw SVG or null.
 *
 * Old-cache contract: every function here keys off sparkline presence, so a
 * pre-feature snapshot (field undefined) renders exactly the legacy output.
 */
import type { Sparkline48h, TrendInfo } from "./types";
import type { SeverityScale } from "./color";
import { basisToSvgUri } from "./color";
import { formatMwh } from "./energy";
import { TREND_COLORS, trendArrow, sparklineCardSvg, sparklineIconSvg, sparklineDescriptionSuffix } from "./sparkline";

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
 * The `| 48h trend | ... |` markdown table row for the hover tooltip:
 * a 200x52 trend chart image above the colored text row content.
 * Returns null when the sparkline is absent — the caller skips the push.
 */
export function sparklineTooltipRow(spark: Sparkline48h | null | undefined): string | null {
  if (!spark) return null;
  const dirWord = spark.direction === "above" ? "above avg" : spark.direction === "below" ? "below avg" : "in line with avg";
  const rangePart =
    spark.minMwh != null && spark.maxMwh != null
      ? ` · lo ${formatMwh(spark.minMwh)} – hi ${formatMwh(spark.maxMwh)}`
      : "";
  const card = sparklineCardSvg(spark);
  // Base64 form: the `;utf8` MIME parameter is non-standard and makes the hover
  // renderer fail to classify the payload as an image (silent blank). Base64
  // uses a restricted alphabet, so the URI is table-safe by construction.
  const chart = card ? `<img src="data:image/svg+xml;base64,${Buffer.from(card, "utf8").toString("base64")}" width="200" height="52"><br>` : "";
  return `| 48h trend | ${chart}<span style="color:${TREND_COLORS[spark.direction]}">${trendArrow(spark.direction)} ${dirWord}</span>${rangePart} |`;
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
 * Footer line for the row hover tooltip: Copy Slug button on the left, then
 * the pricing-page link. The `](` link markers flip VS Code's hover widget to
 * interactive/sticky (hideOnHover=false), so the pointer can move into the
 * tooltip to read the trend chart. Kept out of the table with a blank line so
 * it renders as a paragraph under it. When slug is absent, degrades to the
 * pricing link alone.
 */
export function tooltipFooter(pricingUrl: string, slug: string | null | undefined): string {
  const pricing = `[Open Pricing Page ↗](<${pricingUrl}>)`;
  if (slug == null || slug === "") return `\n\n${pricing}`;
  // Object-shaped arg (stringified + encoded: no raw pipes/quotes/# possible).
  const arg = encodeURIComponent(JSON.stringify({ slug }));
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
