import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ValuedQuote } from "../src/core/types";
import { findModelBySlug, buildModelChartHtml } from "../src/core/chartPanel";

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
  it("contains the tightened CSP, the PNG img at 400x104, and the model identity", () => {
    const html = buildModelChartHtml(valued("kimi-k3"), { fetchedAt: "2026-09-07T00:00:00Z", tariff: 10 });
    assert.ok(html.includes(`default-src 'none'; img-src data:; style-src 'unsafe-inline';`), "CSP pinned");
    assert.ok(!html.includes("https:"), "no https: in img-src");
    assert.ok(html.includes("data:image/png;base64,"), "PNG chart embedded");
    assert.ok(html.includes(`width="400" height="104"`), "panel display size pinned");
    assert.ok(html.includes("Model kimi-k3"), "displayName present");
    assert.ok(html.includes("slug: kimi-k3"), "slug present");
    assert.ok(html.includes("Last updated: 2026-09-07T00:00:00Z"), "fetched-at footer present");
    assert.ok(html.includes("enableScripts") === false, "no scripts marker in static HTML");
  });

  it("escapes <script> payloads in displayName and slug (XSS boundary)", () => {
    const evil = valued("<script>alert(1)</script>", {
      quote: { displayName: "<script>alert('name')</script>", slug: "<script>alert('slug')</script>", sparkline: spark() },
    });
    const html = buildModelChartHtml(evil, { fetchedAt: "<script>alert('t')</script>", tariff: 10 });
    assert.ok(!html.includes("<script>alert"), "no raw script payload may survive");
    assert.ok(html.includes("&lt;script&gt;"), "payload escaped");
  });

  it("renders only the chart img from numeric spark data — no raw user fields in HTML", () => {
    const v = valued("kimi-k3");
    const html = buildModelChartHtml(v, { fetchedAt: null, tariff: 10 });
    assert.ok(!html.includes("Last updated"), "null fetchedAt skips the footer line");
    const imgs = html.match(/<img /g) ?? [];
    assert.equal(imgs.length, 1, "exactly one chart img");
  });

  it("missing spark yields an honest no-data message and no chart img", () => {
    const v = valued("kimi-k3", { quote: { sparkline: null } });
    const html = buildModelChartHtml(v, { fetchedAt: null, tariff: 10 });
    assert.ok(html.includes("No 48h trend data available for this model."), "honest no-data message");
    assert.ok(!html.includes("<img"), "no chart img without spark data");
  });
});
