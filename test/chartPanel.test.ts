import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ValuedQuote } from "../src/core/types";
import { findModelBySlug, findChartTarget, buildModelChartHtml, buildChartPlaceholderHtml } from "../src/core/chartPanel";
import type { FlexEntry } from "../src/core/flexCatalog";
import type { PerfMetricsDoc } from "../src/core/perfMetrics";

function spark(over?: Record<string, unknown>) {
  return {
    points: [
      { x: 0, y: 3 },
      { x: 100, y: 27 },
    ],
    refY: 15,
    direction: "below",
    maxMwh: 51.26,
    minMwh: 8.88,
    ...(over ?? {}),
  } as never;
}

function valued(slug: string, over?: Record<string, unknown>): ValuedQuote {
  const { quote: quoteOver, ...restOver } = over ?? {};
  return {
    quote: {
      displayName: `Model ${slug}`,
      slug,
      isPreview: false,
      contextBand: null,
      cachePct: null,
      rightNowMwh: 22.31,
      typicalMwh: 20.0,
      trend: null,
      sparkline: spark(),
      bands: [],
      capturedAt: "2026-09-07T00:00:00Z",
      ...((quoteOver as Record<string, unknown>) ?? {}),
    },
    basisMwh: 20.0,
    score: null,
    value: null,
    costPer1kUsd: null,
    descriptionMwh: 22.31,
    ...restOver,
  } as unknown as ValuedQuote;
}

describe("chartPanel — findModelBySlug", () => {
  it("hits on exact slug, misses unknown, empty board returns null", () => {
    const board = [valued("kimi-k3"), valued("qwen-3")];
    assert.equal(findModelBySlug(board, "kimi-k3")?.quote.slug, "kimi-k3");
    assert.equal(findModelBySlug(board, "nope"), null);
    assert.equal(findModelBySlug([], "kimi-k3"), null);
  });
});

describe("chartPanel — buildModelChartHtml", () => {
  it("contains the tightened CSP, the inline SVG chart, and the model identity", () => {
    const html = buildModelChartHtml(valued("kimi-k3"), { fetchedAt: "2026-09-07T00:00:00Z", tariff: 10, now: new Date("2026-09-07T00:05:00Z") });
    assert.ok(html.includes(`default-src 'none'; img-src data:; style-src 'unsafe-inline';`), "CSP pinned");
    assert.ok(!html.includes("https:"), "no https: in img-src");
    assert.ok(html.includes(`<svg class="trend-chart"`), "inline SVG chart embedded");
    assert.ok(!html.includes("<img"), "no raster chart");
    assert.ok(html.includes("Model kimi-k3"), "displayName present");
    assert.ok(html.includes("<code>kimi-k3</code>"), "slug present");
    assert.ok(html.includes("Updated 5m ago"), "relative fetched-at footer present");
    assert.ok(html.includes("2026-09-07T00:00:00Z"), "exact fetched-at kept");
    assert.ok(html.includes("enableScripts") === false, "no scripts marker in static HTML");
    assert.ok(!html.includes("<script"), "no script tags");
  });

  it("escapes <script> payloads in displayName and slug (XSS boundary)", () => {
    const evil = valued("<script>alert(1)</script>", {
      quote: { displayName: "<script>alert('name')</script>", slug: "<script>alert('slug')</script>", sparkline: spark() },
    });
    const html = buildModelChartHtml(evil, { fetchedAt: "<script>alert('t')</script>", tariff: 10 });
    assert.ok(!html.includes("<script>alert"), "no raw script payload may survive");
    assert.ok(html.includes("&lt;script&gt;"), "payload escaped");
  });

  it("renders exactly one chart from numeric spark data and skips the footer without fetchedAt", () => {
    const html = buildModelChartHtml(valued("kimi-k3"), { fetchedAt: null, tariff: 10 });
    assert.ok(!html.includes("Updated"), "null fetchedAt skips the footer line");
    assert.equal((html.match(/<svg /g) ?? []).length, 1, "exactly one chart svg");
  });

  it("missing spark yields an honest no-data message and no chart img", () => {
    const v = valued("kimi-k3", { quote: { sparkline: null } });
    const html = buildModelChartHtml(v, { fetchedAt: null, tariff: 10 });
    assert.ok(html.includes("No 48h trend data available for this model."), "honest no-data message");
    assert.ok(!html.includes("<img"), "no chart img without spark data");
  });

  it("compact mode sizes the chart for the sidebar and keeps the CSP", () => {
    const html = buildModelChartHtml(valued("kimi-k3"), { fetchedAt: null, tariff: 10, compact: true });
    assert.ok(html.includes(`viewBox="0 0 420 220"`), "sidebar-sized chart");
    assert.ok(html.includes("background:transparent"), "blends into the sidebar");
    assert.ok(html.includes(`default-src 'none'`), "CSP kept");
  });

  it("placeholder escapes its message and has no chart", () => {
    const html = buildChartPlaceholderHtml(`No board data for "<b>x</b>"`);
    assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
    assert.ok(!html.includes("<svg"));
    assert.ok(html.includes(`default-src 'none'`));
  });

  it("includes performance KPI strip and 48h Throughput chart when perf metrics are present", () => {
    const v = valued("kimi-k3", {
      bangForBuck: 1.51,
      perf: {
        slug: "kimi-k3",
        firstTokenMs: { p50: 473, p95: 1260 },
        throughputToks: { p50: 563, p95: 863 },
        cacheHitPct: 98,
        throughputSparkline: {
          points: [
            { x: 0, y: 20 },
            { x: 100, y: 8 },
          ],
          refY: 15,
          minToks: 493,
          maxToks: 684,
        },
      },
    });
    const html = buildModelChartHtml(v, { fetchedAt: "2026-09-07T00:00:00Z", tariff: 10, now: new Date("2026-09-07T00:05:00Z") });
    assert.equal((html.match(/<svg /g) ?? []).length, 2, "renders both energy and throughput SVG charts");
    assert.ok(html.includes("563 tok/s"), "throughput p50 shown");
    assert.ok(html.includes('color:#34d399;">563 tok/s</span>'), "throughput KPI tinted emerald when above 7d avg");
    assert.ok(html.includes('color:#34d399;">22.31 mWh</span>'), "energy KPI tinted emerald when below avg");
    assert.ok(html.includes("473 ms"), "TTFT p50 shown");
    assert.ok(html.includes("1.51"), "bang for buck shown");
    assert.ok(html.includes("48h Throughput"), "throughput section heading shown");
    assert.ok(html.includes("?view=performance"), "perf source provenance in footer");
  });

  it("findChartTarget scales energy, sparkline bounds, and renders Flex price + Dispatch Wait for flex: keys", () => {
    const base = valued("kimi-k3", {
      bangForBuck: 2.0,
      descriptionMwh: 100,
      quote: { rightNowMwh: 100, typicalMwh: 80, sparkline: spark({ minMwh: 40, maxMwh: 120 }) },
    });
    const flexEntry: FlexEntry = {
      slug: "kimi-k3-flex",
      baseSlug: "kimi-k3",
      name: "Kimi K3 (flex)",
      provider: "nw",
      family: null,
      context: 128000,
      inputPerMillion: 0.1,
      outputPerMillion: 0.25,
      cacheReadPerMillion: null,
      provenance: "v1-derived",
      membership: "both",
      flexMultiplier: 0.5,
      multiplierOrigin: "alias-own",
      preview: false,
      tbdReason: null,
      description: null,
      lastUpdated: null,
      standard: { inputPerMillion: 0.2, outputPerMillion: 0.5, cacheReadPerMillion: null, source: "v1-standard" },
    };
    const perfDoc: PerfMetricsDoc = {
      standard: {},
      flex: { "kimi-k3": { slug: "kimi-k3", firstTokenMs: null, throughputToks: null, cacheHitPct: null, flexDispatchWaitMs: { p50: 6040, p95: 60000 } } },
    };
    const target = findChartTarget([base], [flexEntry], perfDoc, "flex:kimi-k3-flex")!;
    assert.ok(target);
    assert.equal(target.valued.descriptionMwh, 50);
    assert.equal(target.valued.quote.sparkline?.minMwh, 20);
    assert.equal(target.valued.quote.sparkline?.maxMwh, 60);
    assert.equal(target.valued.bangForBuck, 4.0);
    const html = buildModelChartHtml(target.valued, { fetchedAt: null, tariff: 10, compact: true, flex: target.flex });
    assert.ok(html.includes("0.5× Flex"), "flex badge shown");
    assert.ok(html.includes("Charged Energy"), "charged energy KPI label shown");
    assert.ok(html.includes("50.00 mWh"), "subsidized energy shown");
    assert.ok(html.includes("$0.10 / $0.25"), "flex price shown");
    assert.ok(html.includes("Dispatch Wait"), "dispatch wait KPI shown");
    assert.ok(html.includes("6.04 s"), "dispatch wait p50 shown");
  });

  it("resolves alias flex entries via perfDoc.aliases and displays linked backend slug", () => {
    const backend = valued("alpha-flash", {
      bangForBuck: 3.0,
      descriptionMwh: 40,
      quote: { displayName: "Alpha Flash", rightNowMwh: 40, typicalMwh: 50, sparkline: spark({ minMwh: 20, maxMwh: 80 }) },
    });
    const aliasFlex: FlexEntry = {
      slug: "alias-flash-flex",
      baseSlug: "alias-flash",
      name: "Alias Flash (flex)",
      provider: "nw",
      family: null,
      context: 128000,
      inputPerMillion: 0.1,
      outputPerMillion: 0.39,
      cacheReadPerMillion: null,
      provenance: "v1-alias",
      membership: "v1-alias",
      flexMultiplier: 0.5,
      multiplierOrigin: "alias-own",
      preview: false,
      tbdReason: null,
      description: null,
      lastUpdated: null,
      standard: { inputPerMillion: 0.2, outputPerMillion: 0.78, cacheReadPerMillion: null, source: "v1-standard" },
    };
    const perfDoc: PerfMetricsDoc = {
      standard: {},
      flex: { "alpha-flash": { slug: "alpha-flash", firstTokenMs: null, throughputToks: null, cacheHitPct: null, flexDispatchWaitMs: { p50: 3000, p95: 15000 } } },
      aliases: { "alias-flash": "alpha-flash" },
    };
    const target = findChartTarget([backend], [aliasFlex], perfDoc, "flex:alias-flash-flex")!;
    assert.ok(target);
    assert.equal(target.linkedSlug, "alpha-flash");
    assert.equal(target.valued.descriptionMwh, 20);
    assert.equal(target.valued.quote.sparkline?.minMwh, 10);
    assert.equal(target.valued.bangForBuck, 6.0);
    const html = buildModelChartHtml(target.valued, {
      fetchedAt: null,
      tariff: 10,
      compact: true,
      flex: target.flex,
      linkedSlug: target.linkedSlug,
    });
    assert.ok(html.includes("<code>alias-flash-flex</code>"), "alias slug shown");
    assert.ok(html.includes("<code>alpha-flash</code>"), "linked backend slug shown");
    assert.ok(html.includes("20.00 mWh"), "subsidized energy from linked backend shown");
    assert.ok(html.includes("48h Energy"), "48h energy chart rendered");
  });
});
