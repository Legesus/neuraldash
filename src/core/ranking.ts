import type { BandKey, ModelQuote, ScoreTable, SortOrder, ValuedQuote } from "./types";
import type { FlexEntry } from "./flexCatalog";
import type { PerfMetricsDoc } from "./perfMetrics";
import { BAND_KEYS } from "./types";
import { costPer1kUsd } from "./energy";

export type BasisPreference = "typical" | "auto" | BandKey;

function bandMwh(quote: ModelQuote, band: BandKey): number | null {
  const b = quote.bands.find((x) => x.band === band);
  return b ? b.mwh : null;
}

export function resolveBasisMwh(quote: ModelQuote, preferred: BasisPreference): number | null {
  if (preferred !== "typical" && preferred !== "auto") {
    // explicit band
    const explicit = bandMwh(quote, preferred as BandKey);
    if (explicit != null) return explicit;
    // fallback to typical chain
    if (quote.typicalMwh != null) return quote.typicalMwh;
    if (quote.rightNowMwh != null) return quote.rightNowMwh;
    // first non-null band
    for (const bk of BAND_KEYS) {
      const v = bandMwh(quote, bk);
      if (v != null) return v;
    }
    return null;
  }
  // typical or auto: same per ADR-6
  if (preferred === "typical" || preferred === "auto") {
    if (quote.typicalMwh != null) return quote.typicalMwh;
    if (quote.rightNowMwh != null) return quote.rightNowMwh;
    for (const bk of BAND_KEYS) {
      const v = bandMwh(quote, bk);
      if (v != null) return v;
    }
    return null;
  }
  return null;
}

function resolveDescriptionMwh(quote: ModelQuote, preferred: BasisPreference): number | null {
  if (preferred !== "typical" && preferred !== "auto") {
    const explicit = bandMwh(quote, preferred as BandKey);
    if (explicit != null) return explicit;
  }
  return quote.rightNowMwh ?? quote.typicalMwh ?? null;
}

export function rankQuotes(
  quotes: ModelQuote[],
  scoreTable: ScoreTable | null,
  tariffPerKWh: number,
  preferredBand: BasisPreference,
  perfDoc: PerfMetricsDoc | null = null,
): ValuedQuote[] {
  const out: ValuedQuote[] = [];
  for (const q of quotes) {
    const basisMwh = resolveBasisMwh(q, preferredBand);
    const descriptionMwh = resolveDescriptionMwh(q, preferredBand);
    const score = scoreTable?.scores[q.slug] ?? null;
    let value: number | null = null;
    if (score && basisMwh != null && basisMwh > 0) {
      value = score.performanceScore / basisMwh;
    }
    const perf = perfDoc?.standard[q.slug] ?? null;
    const tokP50 = perf?.throughputToks?.p50 ?? null;
    const bangForBuck = tokP50 != null && basisMwh != null && basisMwh > 0 ? tokP50 / basisMwh : null;
    const costPer1k = costPer1kUsd(descriptionMwh, tariffPerKWh);
    out.push({
      quote: q,
      basisMwh,
      score,
      value,
      costPer1kUsd: costPer1k,
      descriptionMwh,
      perf,
      bangForBuck,
    });
  }
  return out;
}

function cmpNullsLast(a: number | null | undefined, b: number | null | undefined, desc = false): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return desc ? b - a : a - b;
}

/**
 * The energy a board row actually displays (descriptionMwh — right-now first),
 * falling back to the ranking basis when the row shows no number. Energy
 * ordering and severity color follow this key so the visible list runs
 * monotonically cheapest -> most expensive; value ranking keeps basisMwh
 * (typical-first), which stays stable poll-to-poll.
 */
export function energySortKey(v: ValuedQuote): number | null {
  return v.descriptionMwh ?? v.basisMwh;
}

export function sortValued(list: ValuedQuote[], order: SortOrder): ValuedQuote[] {
  const arr = [...list];
  arr.sort((a, b) => {
    let diff = 0;
    if (order === "bangForBuck") {
      diff = cmpNullsLast(a.bangForBuck, b.bangForBuck, true) || cmpNullsLast(a.basisMwh, b.basisMwh);
    } else if (order === "fastest") {
      diff =
        cmpNullsLast(a.perf?.throughputToks?.p50, b.perf?.throughputToks?.p50, true) ||
        cmpNullsLast(a.perf?.firstTokenMs?.p50, b.perf?.firstTokenMs?.p50);
    } else {
      diff = cmpNullsLast(energySortKey(a), energySortKey(b)) || cmpNullsLast(a.costPer1kUsd, b.costPer1kUsd);
    }
    return diff !== 0 ? diff : a.quote.displayName.localeCompare(b.quote.displayName);
  });
  return arr;
}

/**
 * Sort Flex tier entries using the active board SortOrder:
 * - bangForBuck: Flex-adjusted bang-for-buck (tok/s ÷ charged mWh) descending, tiebreak dispatch wait p50 ascending
 * - fastest: Flex dispatch wait p50 ascending, tiebreak base throughput p50 descending
 * - lowestPrice: Flex charged energy ascending, tiebreak flex input $/1M ascending
 */
export function sortFlexEntries(
  entries: readonly FlexEntry[],
  valued: readonly ValuedQuote[],
  perfDoc: PerfMetricsDoc | null,
  order: SortOrder,
): FlexEntry[] {
  const bySlug = new Map(valued.map((v) => [v.quote.slug, v]));
  const arr = [...entries];
  arr.sort((a, b) => {
    const ba = bySlug.get(a.baseSlug);
    const bb = bySlug.get(b.baseSlug);
    const wa = (perfDoc?.flex[a.baseSlug] ?? perfDoc?.flex[a.slug])?.flexDispatchWaitMs?.p50 ?? null;
    const wb = (perfDoc?.flex[b.baseSlug] ?? perfDoc?.flex[b.slug])?.flexDispatchWaitMs?.p50 ?? null;
    const ea = ba ? energySortKey(ba) : null;
    const eb = bb ? energySortKey(bb) : null;
    const chargedA = ea != null && a.flexMultiplier != null && a.flexMultiplier > 0 ? ea * a.flexMultiplier : ea;
    const chargedB = eb != null && b.flexMultiplier != null && b.flexMultiplier > 0 ? eb * b.flexMultiplier : eb;
    let diff = 0;
    if (order === "bangForBuck") {
      const bfbA = ba?.bangForBuck != null && a.flexMultiplier != null && a.flexMultiplier > 0 ? ba.bangForBuck / a.flexMultiplier : ba?.bangForBuck;
      const bfbB = bb?.bangForBuck != null && b.flexMultiplier != null && b.flexMultiplier > 0 ? bb.bangForBuck / b.flexMultiplier : bb?.bangForBuck;
      diff = cmpNullsLast(bfbA, bfbB, true) || cmpNullsLast(wa, wb);
    } else if (order === "fastest") {
      diff = cmpNullsLast(wa, wb) || cmpNullsLast(ba?.perf?.throughputToks?.p50, bb?.perf?.throughputToks?.p50, true);
    } else {
      diff = cmpNullsLast(chargedA, chargedB) || cmpNullsLast(a.inputPerMillion, b.inputPerMillion);
    }
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
  return arr;
}

export interface EnergyPartition {
  readonly ranked: ValuedQuote[];
  readonly noEnergy: ValuedQuote[];
}

export function partitionByEnergy(valued: ValuedQuote[]): EnergyPartition {
  const ranked: ValuedQuote[] = [];
  const noEnergy: ValuedQuote[] = [];
  for (const v of valued) {
    if (v.descriptionMwh == null) noEnergy.push(v);
    else ranked.push(v);
  }
  return { ranked, noEnergy };
}

export function topRankedSlug(valued: ValuedQuote[], order: SortOrder): string | null {
  const sorted = sortValued(valued, order);
  const top = sorted[0];
  if (!top) return null;
  if (order === "bangForBuck" && top.bangForBuck == null) return null;
  if (order === "fastest" && top.perf?.throughputToks?.p50 == null) return null;
  if (order === "lowestPrice" && energySortKey(top) == null) return null;
  return top.quote.slug;
}

export function bestValueSlug(valued: ValuedQuote[]): string | null {
  let best: ValuedQuote | null = null;
  for (const v of valued) {
    if (v.value == null) continue;
    if (!best || (v.value > best.value!)) best = v;
  }
  return best ? best.quote.slug : null;
}
