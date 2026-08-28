import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ModelQuote, ScoreTable } from "../src/core/types";
import { BAND_KEYS } from "../src/core/types";
import { resolveBasisMwh, rankQuotes, sortValued, bestValueSlug } from "../src/core/ranking";

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
  it("sortValued energy: basis asc", () => {
    const a = mkQuote({ displayName: "A", slug: "a", typicalMwh: 30 });
    const b = mkQuote({ displayName: "B", slug: "b", typicalMwh: 10 });
    const table: ScoreTable = { version: 1, scores: {} };
    const valued = rankQuotes([a, b], table, 10, "typical");
    const sorted = sortValued(valued, "energy");
    assert.equal(sorted[0].quote.slug, "b");
    assert.equal(sorted[1].quote.slug, "a");
  });

  it("sortValued value: desc, nulls last, basis tie-breaker", () => {
    const a = mkQuote({ displayName: "A", slug: "a", typicalMwh: 10 }); // score 100 => value 10
    const b = mkQuote({ displayName: "B", slug: "b", typicalMwh: 10 }); // score 50 => value 5
    const c = mkQuote({ displayName: "C", slug: "c", typicalMwh: 10 }); // no score => null last
    const table: ScoreTable = {
      version: 1,
      scores: {
        a: { performanceScore: 100, source: "s", asOf: "2026-01-01" },
        b: { performanceScore: 50, source: "s", asOf: "2026-01-01" },
      },
    };
    const valued = rankQuotes([c, b, a], table, 10, "typical");
    const sorted = sortValued(valued, "value");
    assert.equal(sorted[0].quote.slug, "a");
    assert.equal(sorted[1].quote.slug, "b");
    assert.equal(sorted[2].quote.slug, "c");
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
