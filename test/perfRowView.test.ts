import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { modelRowDescription, buildModelTooltipMd, ttftDotColor, sortBadgeLabel } from "../src/core/rowView";
import { buildFlexTooltipMd } from "../src/core/flexHover";
import type { ValuedQuote } from "../src/core/types";
import type { FlexEntry } from "../src/core/flexCatalog";

function mkValued(overrides: Partial<ValuedQuote> = {}): ValuedQuote {
  return {
    quote: {
      displayName: "Alpha Flash",
      slug: "alpha-flash",
      isPreview: false,
      contextBand: "64k-256k",
      cachePct: 98,
      rightNowMwh: 14,
      typicalMwh: 14,
      trend: null,
      bands: [],
      capturedAt: "2026-11-13T00:00:00Z",
    },
    basisMwh: 14,
    score: null,
    value: null,
    costPer1kUsd: 0.14,
    descriptionMwh: 14,
    perf: {
      slug: "alpha-flash",
      firstTokenMs: { p50: 538, p95: 2190 },
      throughputToks: { p50: 228, p95: 448 },
      cacheHitPct: 98,
    },
    bangForBuck: 228 / 14,
    ...overrides,
  };
}

describe("rowView — wired per sortOrder + perf tooltip", () => {
  it("adapts row description to bangForBuck, fastest, and lowestPrice, rendering — for nulls", () => {
    const v = mkValued();
    assert.equal(
      modelRowDescription(v.descriptionMwh, v.costPer1kUsd, null, null, {
        sortOrder: "bangForBuck",
        perf: v.perf,
        bangForBuck: v.bangForBuck,
      }),
      "16.3 tok/s·mWh · 228 tok/s · 14.00 mWh",
    );
    assert.equal(
      modelRowDescription(v.descriptionMwh, v.costPer1kUsd, null, null, {
        sortOrder: "fastest",
        perf: v.perf,
        bangForBuck: v.bangForBuck,
      }),
      "228 tok/s · 538 ms · 14.00 mWh",
    );
    assert.equal(
      modelRowDescription(v.descriptionMwh, v.costPer1kUsd, null, null, {
        sortOrder: "lowestPrice",
        perf: v.perf,
        bangForBuck: v.bangForBuck,
      }),
      "14.00 mWh · $0.14/1k · 228 tok/s",
    );
    assert.equal(
      modelRowDescription(null, null, null, null, {
        sortOrder: "fastest",
        perf: { slug: "x", firstTokenMs: null, throughputToks: null, cacheHitPct: null },
        bangForBuck: null,
      }),
      "— tok/s · — · —",
    );
  });

  it("renders TTFT dot color thresholds (<300ms green, <1000ms yellow, else orange) and active-mode badges", () => {
    assert.equal(ttftDotColor(250), "#4ec9b0");
    assert.equal(ttftDotColor(538), "#dcdcaa");
    assert.equal(ttftDotColor(1200), "#ce9178");
    assert.equal(sortBadgeLabel("bangForBuck"), "Top Efficiency");
    assert.equal(sortBadgeLabel("fastest"), "Speed Leader");
    assert.equal(sortBadgeLabel("lowestPrice"), "Lowest Cost");

    const md = buildModelTooltipMd(mkValued(), {
      fetchedAt: null,
      isBest: true,
      pricingUrl: "https://portal.neuralwatt.com/energy-pricing",
      tariff: 10,
      sortOrder: "fastest",
    });
    assert.ok(md.includes("**Speed Leader**"));
    assert.ok(md.includes('style="color:#dcdcaa;"'));
    assert.ok(md.includes("**228 tok/s**"));
    assert.ok(md.includes("p95 448 · 98%"));
  });

  it("renders flex dispatch wait and never fabricates throughput", () => {
    const entry: FlexEntry = {
      slug: "alpha-flash-flex",
      baseSlug: "alpha-flash",
      name: "Alpha Flash",
      provider: "Alpha",
      family: "Alpha",
      description: null,
      lastUpdated: null,
      preview: false,
      context: 128000,
      inputPerMillion: 0.1,
      outputPerMillion: 0.2,
      cacheReadPerMillion: 0.05,
      flexMultiplier: 0.65,
      membership: "perf-lane",
      provenance: "v1-derived",
    };
    const md = buildFlexTooltipMd(entry, null, null, {
      pricingUrl: "https://portal.neuralwatt.com/energy-pricing",
      dispatchWait: { p50: 6040, p95: 60000 },
    });
    assert.ok(md.includes("**6.04 s**"));
    assert.ok(md.includes("p95 60.00 s"));
    assert.ok(!md.includes("tok/s"));
  });

  it("renders 48h throughput sparkline in model tooltip and 48h flex hold bars in flex tooltip", () => {
    const v = mkValued({
      perf: {
        slug: "alpha-flash",
        firstTokenMs: { p50: 538, p95: 2190 },
        throughputToks: { p50: 228, p95: 448 },
        cacheHitPct: 98,
        throughputSparkline: {
          points: [
            { x: 1, y: 24 },
            { x: 50, y: 16 },
            { x: 100, y: 10 },
            { x: 134, y: 6 },
          ],
          refY: 20,
          minToks: 206,
          maxToks: 403,
        },
      },
    });
    const modelMd = buildModelTooltipMd(v, {
      fetchedAt: null,
      isBest: false,
      pricingUrl: "https://portal.neuralwatt.com/energy-pricing",
      tariff: 10,
      sortOrder: "fastest",
    });
    assert.ok(modelMd.includes("48h · 206–403 tok/s"));
    assert.ok(modelMd.includes("▲ above 7d"));

    const entry: FlexEntry = {
      slug: "alpha-flash-flex",
      baseSlug: "alpha-flash",
      name: "Alpha Flash",
      provider: "Alpha",
      family: "Alpha",
      description: null,
      lastUpdated: null,
      preview: false,
      context: 128000,
      inputPerMillion: 0.1,
      outputPerMillion: 0.2,
      cacheReadPerMillion: 0.05,
      flexMultiplier: 0.65,
      membership: "perf-lane",
      provenance: "v1-derived",
    };
    const flexMd = buildFlexTooltipMd(entry, null, null, {
      pricingUrl: "https://portal.neuralwatt.com/energy-pricing",
      dispatchWait: { p50: 6040, p95: 60000 },
      flexHoldBars: {
        bars: [
          { x: 10, height: 6 },
          { x: 60, height: 26 },
        ],
        minLabel: "0 s",
        maxLabel: "60.0 s",
      },
    });
    assert.ok(flexMd.includes("| 48h flex hold"));
    assert.ok(flexMd.includes("0 s–60.0 s"));
  });
});
