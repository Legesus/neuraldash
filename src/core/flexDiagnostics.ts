/**
 * Flex catalog evidence dump (pure, vscode-free) for the
 * `neuraldash.debugFlex` OutputChannel command: one line per derived row
 * showing WHICH document established membership, WHICH document priced it
 * (with the exact values), the multiplier + ladder rung, the preview flag and
 * a report-only cross-check against the live board's preview markers.
 */
import type { FlexEntry, FlexSources } from "./flexCatalog";

export interface FlexDiagnosticsInput {
  readonly entries: readonly FlexEntry[];
  readonly sources: FlexSources;
  readonly v1Hash: string | null;
  readonly perfHash: string | null;
  readonly cardsHash: string | null;
  readonly harvest: { distinct: number[]; value: number | null };
  readonly boardPreviewSlugs: ReadonlySet<string>;
  /**
   * All live board slugs. The board preview cross-check only compares models
   * that are ON the board; an optional extension of the base contract so that
   * preview rows absent from the board are not reported as mismatches.
   */
  readonly boardSlugs?: ReadonlySet<string>;
}

const NONE = "(none)";

function hashPrefix(hash: string | null): string {
  return hash ? hash.slice(0, 12) : NONE;
}

function fetched(at: string | null | undefined): string {
  return at ? `fetched ${at}` : "fetched \u2014";
}

function price(v: number | null): string {
  return v == null ? "-" : String(v);
}

function docLine(name: string, url: string | null, hash: string | null, at: string | null | undefined): string {
  return `${name}: ${url ?? NONE} (${fetched(at)}; sha256 ${hashPrefix(hash)})`;
}

function membershipEvidence(entry: FlexEntry, sources: FlexSources): string {
  const parts: string[] = [];
  if (entry.membership !== "v1-alias") {
    parts.push(
      `perf view lane "${entry.baseSlug}" (${sources.perf?.url ?? "url unknown"}, ${fetched(sources.perf?.fetchedAt)})`,
    );
  }
  if (entry.membership !== "perf-lane") {
    parts.push(
      `/v1/models alias "${entry.slug}" (${sources.v1?.url ?? "url unknown"}, ${fetched(sources.v1?.fetchedAt)})`,
    );
  }
  return parts.join(" + ");
}

function pricingLine(entry: FlexEntry): string {
  const values = `in=${price(entry.inputPerMillion)} out=${price(entry.outputPerMillion)} cached=${price(entry.cacheReadPerMillion)}`;
  if (entry.provenance === "tbd") {
    return `tbd (${entry.tbdReason ?? "no published pricing"}) ${values}`;
  }
  // Card output/cached come from the footer's display-rounded text — say so.
  const caveat = entry.provenance === "portal-card" ? " (input exact; output display-rounded)" : "";
  return `${entry.provenance} ${values}${caveat}`;
}

export function buildFlexDiagnostics(input: FlexDiagnosticsInput): string {
  const lines: string[] = [];
  lines.push("NeuralDash flex catalog diagnostics");
  lines.push("===================================");
  lines.push(docLine("/v1/models", input.sources.v1?.url ?? null, input.v1Hash, input.sources.v1?.fetchedAt));
  lines.push(docLine("perf view  ", input.sources.perf?.url ?? null, input.perfHash, input.sources.perf?.fetchedAt));
  lines.push(docLine("portal cards", input.sources.cards?.url ?? null, input.cardsHash, input.sources.cards?.fetchedAt));
  const harvestValue = input.harvest.value == null ? "unavailable" : String(input.harvest.value);
  lines.push(`multiplier harvest: distinct=[${input.harvest.distinct.join(", ")}] value=${harvestValue}`);
  lines.push(`board slugs: ${input.boardSlugs?.size ?? 0} | board preview slugs: ${input.boardPreviewSlugs.size}`);
  lines.push(`rows: ${input.entries.length}`);
  lines.push("");

  for (const entry of input.entries) {
    lines.push(`- ${entry.slug} (base ${entry.baseSlug}, membership ${entry.membership})`);
    lines.push(`  name: ${entry.name} | provider: ${entry.provider} | family: ${entry.family ?? "-"} | context: ${entry.context ?? "-"}`);
    lines.push(`  membership evidence: ${membershipEvidence(entry, input.sources)}`);
    lines.push(`  pricing: ${pricingLine(entry)}`);
    lines.push(
      `  multiplier: ${entry.flexMultiplier == null ? "-" : String(entry.flexMultiplier)} (${entry.multiplierOrigin ?? "-"})`,
    );
    lines.push(`  preview: ${entry.preview}`);
    const onBoard = input.boardSlugs?.has(entry.baseSlug) ?? false;
    const boardPreview = input.boardPreviewSlugs.has(entry.baseSlug);
    if (onBoard && boardPreview !== entry.preview) {
      lines.push(`  MISMATCH: board preview=${boardPreview} but perf view chip=${entry.preview} (report-only)`);
    }
  }
  return lines.join("\n");
}
