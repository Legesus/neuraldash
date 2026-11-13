import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ModelQuote, ScoreTable, ValuedQuote } from "../src/core/types";
import { BAND_KEYS } from "../src/core/types";
import { resolveBasisMwh, rankQuotes, sortValued, sortFlexEntries, bestValueSlug, topRankedSlug, partitionByEnergy } from "../src/core/ranking";
import type { FlexEntry } from "../src/core/flexCatalog";
import type { PerfMetricsDoc } from "../src/core/perfMetrics";

function mkQuote(over: Partial<ModelQuote> & { displayName: string; slug: string }): ModelQuote {
  return {
    displayName: over.displayName,
    slug: over.slug,
    isPreview: over.isPreview ?? false,
    contextBand: over.contextBand ?? null,
    cachePct: over.cachePct ?? null,
    rightNowMwh: over.rightNowMwh ?? null,
    typicalMwh: over.typicalMwh ?? null,
    trend: over.trend ?? null,
    bands: over.bands ?? BAND_KEYS.map((b) => ({ band: b, mwh: null, sharePct: null })),
    capturedAt: over.capturedAt ?? new Date().toISOString(),
  };
}

function mkBands(vals: (number | null)[]): ModelQuote["bands"] {
  return BAND_KEYS.map((b, i) => ({ band: b, mwh: vals[i] ?? null, sharePct: null }));
}

describe("ranking.resolveBasisMwh", () => {
  it("typical: typical ?? rightNow ?? first non-null band", () => {
    const q1 = mkQuote({ displayName: "A", slug: "a", typicalMwh: 10, rightNowMwh: 20, bands: mkBands([5, null, null, null, null, null, null]) });
    assert.equal(resolveBasisMwh(q1, "typical"), 10);
    const q2 = mkQuote({ displayName: "B", slug: "b", typicalMwh: null, rightNowMwh: 20, bands: mkBands([5, null, null, null, null, null, null]) });
    assert.equal(resolveBasisMwh(q2, "typical"), 20);
    const q3 = mkQuote({ displayName: "C", slug: "c", typicalMwh: null, rightNowMwh: null, bands: mkBands([null, 7, null, null, null, null, null]) });
    assert.equal(resolveBasisMwh(q3, "typical"), 7);
    const q4 = mkQuote({ displayName: "D", slug: "d", bands: mkBands([null, null, null, null, null, null, null]) });
    assert.equal(resolveBasisMwh(q4, "typical"), null);
  });

  it("auto: same as typical", () => {
    const q = mkQuote({ displayName: "A", slug: "a", typicalMwh: 10, rightNowMwh: 20 });
    assert.equal(resolveBasisMwh(q, "auto"), 10);
    const q2 = mkQuote({ displayName: "B", slug: "b", typicalMwh: null, rightNowMwh: 20 });
    assert.equal(resolveBasisMwh(q2, "auto"), 20);
  });

  it("explicit band: band ?? typical", () => {
    const q = mkQuote({ displayName: "A", slug: "a", typicalMwh: 10, bands: mkBands([null, null, 30, null, null, null, null]) });
    assert.equal(resolveBasisMwh(q, "1k-4k"), 30);
    const q2 = mkQuote({ displayName: "B", slug: "b", typicalMwh: 10, bands: mkBands([null, null, null, null, null, null, null]) });
    assert.equal(resolveBasisMwh(q2, "1k-4k"), 10);
    const q3 = mkQuote({ displayName: "C", slug: "c", bands: mkBands([null, null, null, null, null, null, null]) });
    assert.equal(resolveBasisMwh(q3, "1k-4k"), null);
  });
});

describe("ranking.rankQuotes value", () => {
  it("value null when no score", () => {
    const q = mkQuote({ displayName: "A", slug: "a", typicalMwh: 10 });
    const valued = rankQuotes([q], { version: 1, scores: {} }, 10, "typical");
    assert.equal(valued[0].value, null);
    assert.equal(valued[0].basisMwh, 10);
  });

  it("value null when basis null", () => {
    const q = mkQuote({ displayName: "A", slug: "a" });
    const table: ScoreTable = { version: 1, scores: { a: { performanceScore: 80, source: "s", asOf: "2026-01-01" } } };
    const valued = rankQuotes([q], table, 10, "typical");
    assert.equal(valued[0].value, null);
  });

  it("value = score / basisMwh", () => {
    const q = mkQuote({ displayName: "A", slug: "a", typicalMwh: 100 });
    const table: ScoreTable = { version: 1, scores: { a: { performanceScore: 50, source: "s", asOf: "2026-01-01" } } };
    const valued = rankQuotes([q], table, 10, "typical");
    assert.equal(valued[0].value, 0.5);
  });

  it("costPer1kUsd derived from descriptionMwh", () => {
    const q = mkQuote({ displayName: "A", slug: "a", rightNowMwh: 200, typicalMwh: 100 });
    const valued = rankQuotes([q], null, 10, "typical");
    // descriptionMwh = rightNow ?? typical = 200
    assert.equal(valued[0].descriptionMwh, 200);
    assert.equal(valued[0].costPer1kUsd, 2);
  });
});

describe("ranking comparators", () => {
  it("sortValued lowestPrice: displayed energy asc (typical when no live number)", () => {
    const a = mkQuote({ displayName: "A", slug: "a", typicalMwh: 30 });
    const b = mkQuote({ displayName: "B", slug: "b", typicalMwh: 10 });
    const table: ScoreTable = { version: 1, scores: {} };
    const valued = rankQuotes([a, b], table, 10, "typical");
    const sorted = sortValued(valued, "lowestPrice");
    assert.equal(sorted[0].quote.slug, "b");
    assert.equal(sorted[1].quote.slug, "a");
  });

  it("sortValued lowestPrice: fast-lane rows sort by the DISPLAYED number, not typical", () => {
    const surge = mkQuote({ displayName: "Surge", slug: "surge", typicalMwh: 1300, rightNowMwh: 370 });
    const steady = mkQuote({ displayName: "Steady", slug: "steady", typicalMwh: 937, rightNowMwh: 683 });
    const valued = rankQuotes([surge, steady], { version: 1, scores: {} }, 10, "typical");
    const sorted = sortValued(valued, "lowestPrice");
    assert.equal(sorted[0].quote.slug, "surge", "370 displayed must sit above 683 displayed");
    assert.equal(sorted[1].quote.slug, "steady");
  });

  it("sortValued lowestPrice: band-only rows (no displayed number) fall back to basis", () => {
    const bandOnly = mkQuote({ displayName: "BandOnly", slug: "band-only", bands: mkBands([null, 7, null, null, null, null, null]) });
    const live = mkQuote({ displayName: "Live", slug: "live", rightNowMwh: 20, typicalMwh: 25 });
    const valued = rankQuotes([live, bandOnly], { version: 1, scores: {} }, 10, "typical");
    const sorted = sortValued(valued, "lowestPrice");
    assert.equal(sorted[0].quote.slug, "band-only");
    assert.equal(sorted[1].quote.slug, "live");
  });

  it("sortValued bangForBuck: throughput p50 / mWh desc, nulls last, basis asc tiebreak", () => {
    const a = mkQuote({ displayName: "A", slug: "a", typicalMwh: 10 }); // 200 / 10 = 20
    const b = mkQuote({ displayName: "B", slug: "b", typicalMwh: 20 }); // 300 / 20 = 15
    const c = mkQuote({ displayName: "C", slug: "c", typicalMwh: 5 });  // no perf => null last
    const perf: PerfMetricsDoc = {
      standard: {
        a: { slug: "a", firstTokenMs: { p50: 400, p95: 900 }, throughputToks: { p50: 200, p95: 300 }, cacheHitPct: 90 },
        b: { slug: "b", firstTokenMs: { p50: 300, p95: 800 }, throughputToks: { p50: 300, p95: 400 }, cacheHitPct: 80 },
      },
      flex: {},
    };
    const valued = rankQuotes([c, b, a], { version: 1, scores: {} }, 10, "typical", perf);
    const sorted = sortValued(valued, "bangForBuck");
    assert.deepEqual(sorted.map((v) => v.quote.slug), ["a", "b", "c"]);
    assert.equal(topRankedSlug(valued, "bangForBuck"), "a");
  });

  it("sortValued fastest: throughput p50 desc, TTFT p50 asc tiebreak, nulls last", () => {
    const fastSlowTtft = mkQuote({ displayName: "SlowTTFT", slug: "slow-ttft", typicalMwh: 20 });
    const fastQuickTtft = mkQuote({ displayName: "QuickTTFT", slug: "quick-ttft", typicalMwh: 30 });
    const noTok = mkQuote({ displayName: "NoTok", slug: "no-tok", typicalMwh: 10 });
    const perf: PerfMetricsDoc = {
      standard: {
        "slow-ttft": { slug: "slow-ttft", firstTokenMs: { p50: 900, p95: 1500 }, throughputToks: { p50: 250, p95: 400 }, cacheHitPct: 90 },
        "quick-ttft": { slug: "quick-ttft", firstTokenMs: { p50: 400, p95: 800 }, throughputToks: { p50: 250, p95: 400 }, cacheHitPct: 90 },
      },
      flex: {},
    };
    const valued = rankQuotes([noTok, fastSlowTtft, fastQuickTtft], { version: 1, scores: {} }, 10, "typical", perf);
    const sorted = sortValued(valued, "fastest");
    assert.deepEqual(sorted.map((v) => v.quote.slug), ["quick-ttft", "slow-ttft", "no-tok"]);
    assert.equal(topRankedSlug(valued, "fastest"), "quick-ttft");
  });

  it("bestValue ignores null scores", () => {
    const a = mkQuote({ displayName: "A", slug: "a", typicalMwh: 10 });
    const b = mkQuote({ displayName: "B", slug: "b", typicalMwh: 10 });
    const table: ScoreTable = {
      version: 1,
      scores: { b: { performanceScore: 80, source: "s", asOf: "2026-01-01" } },
    };
    const valued = rankQuotes([a, b], table, 10, "typical");
    assert.equal(bestValueSlug(valued), "b");
    const valued2 = rankQuotes([a], { version: 1, scores: {} }, 10, "typical");
    assert.equal(bestValueSlug(valued2), null);
  });
});

describe("ranking.partitionByEnergy", () => {
  function valuedFor(quotes: ModelQuote[]): ValuedQuote[] {
    return rankQuotes(quotes, { version: 1, scores: {} }, 10, "typical");
  }

  it("rows with energy stay in the ranked group in order", () => {
    const valued = valuedFor([
      mkQuote({ displayName: "A", slug: "a", rightNowMwh: 3, typicalMwh: 4 }),
      mkQuote({ displayName: "B", slug: "b", rightNowMwh: 9, typicalMwh: 8 }),
    ]);
    const { ranked, noEnergy } = partitionByEnergy(valued);
    assert.deepEqual(ranked.map((v) => v.quote.slug), ["a", "b"]);
    assert.deepEqual(noEnergy.map((v) => v.quote.slug), []);
  });

  it("rows without an energy value move to the no-energy group", () => {
    const valued = valuedFor([
      mkQuote({ displayName: "A", slug: "a", rightNowMwh: 3 }),
      mkQuote({ displayName: "E", slug: "e", bands: mkBands([null, null, null, null, null, null, null]) }),
    ]);
    const { ranked, noEnergy } = partitionByEnergy(valued);
    assert.deepEqual(ranked.map((v) => v.quote.slug), ["a"]);
    assert.deepEqual(noEnergy.map((v) => v.quote.slug), ["e"]);
  });

  it("empty board partitions to two empty groups", () => {
    const { ranked, noEnergy } = partitionByEnergy([]);
    assert.deepEqual(ranked, []);
    assert.deepEqual(noEnergy, []);
  });

  it("all rows without energy: ranked group empty, group keeps every row in order", () => {
    const valued = valuedFor([
      mkQuote({ displayName: "E", slug: "e", bands: mkBands([null, null, null, null, null, null, null]) }),
      mkQuote({ displayName: "F", slug: "f", bands: mkBands([null, null, null, null, null, null, null]) }),
    ]);
    const { ranked, noEnergy } = partitionByEnergy(valued);
    assert.deepEqual(ranked, []);
    assert.deepEqual(noEnergy.map((v) => v.quote.slug), ["e", "f"]);
  });

  it("a row with no displayed value but a ranking basis goes to the no-energy group", () => {
    const q = mkQuote({ displayName: "B", slug: "b", bands: mkBands([null, 7, null, null, null, null, null]) });
    const valued = rankQuotes([q], { version: 1, scores: {} }, 10, "typical");
    assert.equal(valued[0].descriptionMwh, null);
    assert.equal(valued[0].basisMwh, 7);
    const { ranked, noEnergy } = partitionByEnergy(valued);
    assert.deepEqual(ranked, []);
    assert.deepEqual(noEnergy.map((v) => v.quote.slug), ["b"]);
  });
});

describe("sortFlexEntries", () => {
  const flex = (slug: string, baseSlug: string, mult: number | null, inputPerMillion: number | null): FlexEntry => ({
    slug,
    baseSlug,
    name: slug,
    provider: "nw",
    family: null,
    context: 128000,
    inputPerMillion,
    outputPerMillion: null,
    cacheReadPerMillion: null,
    provenance: "v1-derived",
    membership: "both",
    flexMultiplier: mult,
    multiplierOrigin: "alias-own",
    preview: false,
    tbdReason: null,
    description: null,
    lastUpdated: null,
  });

  const valued = [
    { quote: mkQuote({ displayName: "A", slug: "a", rightNowMwh: 100 }), basisMwh: 100, descriptionMwh: 100, score: null, value: null, costPer1kUsd: 1, bangForBuck: 2.0 },
    { quote: mkQuote({ displayName: "B", slug: "b", rightNowMwh: 50 }), basisMwh: 50, descriptionMwh: 50, score: null, value: null, costPer1kUsd: 0.5, bangForBuck: 1.5 },
  ];

  const perfDoc: PerfMetricsDoc = {
    standard: {},
    flex: {
      a: { slug: "a", firstTokenMs: null, throughputToks: null, cacheHitPct: null, flexDispatchWaitMs: { p50: 8000, p95: 20000 } },
      b: { slug: "b", firstTokenMs: null, throughputToks: null, cacheHitPct: null, flexDispatchWaitMs: { p50: 2000, p95: 5000 } },
    },
  };

  const entries = [flex("b-flex", "b", 0.65, 0.2), flex("a-flex", "a", 0.5, 0.4)];

  it("sorts by bangForBuck descending, fastest by dispatch wait ascending, and lowestPrice by charged energy ascending", () => {
    // a-flex bangForBuck = 2.0 / 0.5 = 4.0 > b-flex 1.5 / 0.65 = 2.31
    assert.deepEqual(sortFlexEntries(entries, valued, perfDoc, "bangForBuck").map((e) => e.slug), ["a-flex", "b-flex"]);
    // b-flex wait 2000ms < a-flex 8000ms
    assert.deepEqual(sortFlexEntries(entries, valued, perfDoc, "fastest").map((e) => e.slug), ["b-flex", "a-flex"]);
    // b-flex charged 50*0.65=32.5 < a-flex 100*0.5=50
    assert.deepEqual(sortFlexEntries(entries, valued, perfDoc, "lowestPrice").map((e) => e.slug), ["b-flex", "a-flex"]);
  });
});
