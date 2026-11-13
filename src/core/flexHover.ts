import type { FlexEntry, FlexSources } from "./flexCatalog";
import type { ValuedQuote } from "./types";
import { tierComparisonTable, flexEnergyTable, formatPrice } from "./cardFormat";
import { escapeMarkdownLocal, tooltipFooter } from "./rowView";
import { formatContextTokens } from "./flex";
import { formatThinkingLine } from "./thinking";
import type { FlexHoldBars, P50P95 } from "./perfMetrics";
import { flexHoldBarsToText, formatLatencyMs, ttftDotColor } from "./rowView";
import type { ThinkingInfo } from "./thinking";

export function buildFlexTooltipMd(
  entry: FlexEntry,
  sources: FlexSources | null,
  base: ValuedQuote | null,
  opts: { pricingUrl: string; thinking?: ThinkingInfo | null; dispatchWait?: P50P95 | null; flexHoldBars?: FlexHoldBars | null },
): string {
  const lines: string[] = [];
  const subtitle = [entry.provider, entry.family].filter((s): s is string => !!s).map(escapeMarkdownLocal).join(" · ");
  lines.push(`**${escapeMarkdownLocal(entry.name)}** · Flex  \n\`${escapeMarkdownLocal(entry.slug)}\`${subtitle ? ` · ${subtitle}` : ""}`);
  lines.push("");
  const std = entry.standard ?? null;
  const priceHead =
    entry.inputPerMillion != null && entry.outputPerMillion != null
      ? `**${formatPrice(entry.inputPerMillion, 2, 2)} / ${formatPrice(entry.outputPerMillion, 2, 2)}**`
      : "\u2014";
  const waitHead = opts.dispatchWait
    ? `<span style="color:${ttftDotColor(opts.dispatchWait.p50)};">\u25cf</span> **${formatLatencyMs(opts.dispatchWait.p50)}**`
    : "\u2014";
  const waitSub = opts.dispatchWait ? `p95 ${formatLatencyMs(opts.dispatchWait.p95)}` : "\u2014";
  const multHead = entry.flexMultiplier != null ? `**${escapeMarkdownLocal(String(entry.flexMultiplier))}\u00d7**` : "\u2014";
  const multSub = `${escapeMarkdownLocal(formatContextTokens(entry.context))} ctx`;

  lines.push(`---`);
  lines.push(`| Flex in/out (1M) | Dispatch wait | Multiplier |`);
  lines.push(`|:---|:---:|---:|`);
  lines.push(`| ${priceHead} | ${waitHead} | ${multHead} |`);
  lines.push(`| ${std ? "vs Normal below" : entry.tbdReason ? escapeMarkdownLocal(entry.tbdReason) : "\u2014"} | ${waitSub} | ${multSub} |`);
  lines.push(`---`);

  const holdGlyphs = flexHoldBarsToText(opts.flexHoldBars);
  if (holdGlyphs) {
    const range = opts.flexHoldBars?.minLabel && opts.flexHoldBars?.maxLabel
      ? ` \u00b7 ${escapeMarkdownLocal(opts.flexHoldBars.minLabel)}\u2013${escapeMarkdownLocal(opts.flexHoldBars.maxLabel)}`
      : "";
    lines.push("", `| | |`, `|:---|:---|`, `| ${holdGlyphs} | 48h flex hold${range} |`);
  }

  const table = tierComparisonTable([
    { label: "Input", normal: std?.inputPerMillion ?? null, flex: entry.inputPerMillion, digits: 2 },
    { label: "Output", normal: std?.outputPerMillion ?? null, flex: entry.outputPerMillion, digits: 2 },
  ]);
  const energyTable = base ? flexEnergyTable(base.descriptionMwh, base.costPer1kUsd, entry.flexMultiplier) : [];
  if (table.length > 0 && energyTable.length > 2) {
    lines.push("", ...table, ...energyTable.slice(2));
  } else if (table.length > 0) {
    lines.push("", ...table);
  } else if (energyTable.length > 0) {
    lines.push("", ...energyTable);
  }

  if (opts.thinking) lines.push("", formatThinkingLine(opts.thinking));
  lines.push(`\n_${escapeMarkdownLocal(flexSourcesLine(entry))}_`);
  lines.push(tooltipFooter(opts.pricingUrl, entry.slug));
  return lines.join("\n");
}

function flexPricingKind(entry: FlexEntry): string {
  switch (entry.provenance) {
    case "v1-alias":
      return "exact";
    case "v1-derived":
    case "portal-card":
      return "derived";
    case "models-dev":
      return "models.dev";
    case "tbd":
      return "TBD";
  }
}

function flexSourcesLine(entry: FlexEntry): string {
  const parts: string[] = [];
  if (entry.membership !== "v1-alias") parts.push("perf");
  const usesV1 = entry.membership !== "perf-lane" || entry.provenance === "v1-alias" || entry.provenance === "v1-derived";
  if (usesV1) parts.push("/v1/models");
  if (entry.provenance === "portal-card") parts.push("/models");
  return `Sources: ${parts.join(" · ")} · ${flexPricingKind(entry)}`;
}