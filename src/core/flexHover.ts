import type { FlexEntry, FlexSources } from "./flexCatalog";
import type { ValuedQuote } from "./types";
import { tierComparisonTable, flexEnergyTable } from "./cardFormat";
import { escapeMarkdownLocal, tooltipFooter } from "./rowView";
import { formatContextTokens } from "./flex";

export function buildFlexTooltipMd(
  entry: FlexEntry,
  sources: FlexSources | null,
  base: ValuedQuote | null,
  opts: { pricingUrl: string },
): string {
  const lines: string[] = [];
  const subtitle = [entry.provider, entry.family].filter((s): s is string => !!s).map(escapeMarkdownLocal).join(" · ");
  lines.push(`**${escapeMarkdownLocal(entry.name)}** · Flex  \n\`${escapeMarkdownLocal(entry.slug)}\`${subtitle ? ` · ${subtitle}` : ""}`);
  if (entry.description) lines.push(`\n${escapeMarkdownLocal(entry.description)}`);
  lines.push("");
  const std = entry.standard ?? null;
  const table = tierComparisonTable([
    { label: "Input", normal: std?.inputPerMillion ?? null, flex: entry.inputPerMillion, digits: 2 },
    { label: "Output", normal: std?.outputPerMillion ?? null, flex: entry.outputPerMillion, digits: 2 },
    { label: "Cache read", normal: std?.cacheReadPerMillion ?? null, flex: entry.cacheReadPerMillion, digits: 2 },
  ]);
  if (table.length > 0) lines.push(...table);
  else lines.push(`_Pricing TBD${entry.tbdReason ? `: ${escapeMarkdownLocal(entry.tbdReason)}` : ""}_`);
  const tierNotes: string[] = [`${escapeMarkdownLocal(formatContextTokens(entry.context))} context tokens`];
  if (entry.flexMultiplier != null) tierNotes.push(`Flex multiplier ${escapeMarkdownLocal(String(entry.flexMultiplier))}×`);
  if (std) tierNotes.push(`Normal from ${std.source === "v1-standard" ? "/v1/models" : "portal /models card"}`);
  lines.push(`\n${tierNotes.join(" · ")}`);
  const updated = entry.lastUpdated ? ` · updated ${escapeMarkdownLocal(entry.lastUpdated)}` : "";
  const energyTable = base ? flexEnergyTable(base.descriptionMwh, base.costPer1kUsd, entry.flexMultiplier) : [];
  if (energyTable.length > 0) {
    lines.push("", ...energyTable);
    lines.push(`\n_Consumed = board right-now for \`${escapeMarkdownLocal(entry.baseSlug)}\` · charged = consumed × Flex multiplier${updated}_`);
  } else {
    lines.push(`\n_No live energy data for Flex rows${updated}_`);
  }
  lines.push(`\n_${escapeMarkdownLocal(flexSourcesLine(entry, sources))}_`);
  lines.push(tooltipFooter(opts.pricingUrl, entry.slug));
  return lines.join("\n");
}

function shortStamp(iso: string | null | undefined): string {
  const m = iso ? /^\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso) : null;
  return m ? `${m[1]} ${m[2]}` : "time unknown";
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

function flexSourcesLine(entry: FlexEntry, sources: FlexSources | null): string {
  const parts: string[] = [];
  if (entry.membership !== "v1-alias") parts.push(`perf view ${shortStamp(sources?.perf?.fetchedAt)}`);
  const usesV1 = entry.membership !== "perf-lane" || entry.provenance === "v1-alias" || entry.provenance === "v1-derived";
  if (usesV1) parts.push(`/v1/models ${shortStamp(sources?.v1?.fetchedAt)}`);
  if (entry.provenance === "portal-card") parts.push(`/models card ${shortStamp(sources?.cards?.fetchedAt)}`);
  return `Sources: ${parts.join(" · ")} · pricing ${flexPricingKind(entry)}`;
}