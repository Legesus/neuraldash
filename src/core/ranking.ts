import type { BandKey, ModelQuote, ScoreEntry, ScoreTable, ValuedQuote } from "./types";
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
    const costPer1k = costPer1kUsd(descriptionMwh, tariffPerKWh);
    out.push({
      quote: q,
      basisMwh,
      score,
      value,
      costPer1kUsd: costPer1k,
      descriptionMwh,
    });
  }
  return out;
}

export type SortOrder = "energy" | "value" | "name";

export function sortValued(list: ValuedQuote[], order: SortOrder): ValuedQuote[] {
  const arr = [...list];
  if (order === "energy") {
    arr.sort((a, b) => {
      const av = a.basisMwh;
      const bv = b.basisMwh;
      if (av == null && bv == null) return a.quote.displayName.localeCompare(b.quote.displayName);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av !== bv) return av - bv;
      return a.quote.displayName.localeCompare(b.quote.displayName);
    });
  } else if (order === "value") {
    arr.sort((a, b) => {
      const av = a.value;
      const bv = b.value;
      if (av == null && bv == null) {
        const am = a.basisMwh;
        const bm = b.basisMwh;
        if (am == null && bm == null) return a.quote.displayName.localeCompare(b.quote.displayName);
        if (am == null) return 1;
        if (bm == null) return -1;
        return am - bm;
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av !== bv) return bv - av; // desc
      // tie-breaker basis asc
      const am = a.basisMwh;
      const bm = b.basisMwh;
      if (am == null && bm == null) return 0;
      if (am == null) return 1;
      if (bm == null) return -1;
      return am - bm;
    });
  } else {
    arr.sort((a, b) => a.quote.displayName.localeCompare(b.quote.displayName));
  }
  return arr;
}

export function bestValueSlug(valued: ValuedQuote[]): string | null {
  let best: ValuedQuote | null = null;
  for (const v of valued) {
    if (v.value == null) continue;
    if (!best || (v.value > best.value!)) best = v;
  }
  return best ? best.quote.slug : null;
}
