import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFlexDiagnostics } from "../src/core/flexDiagnostics";
import { buildFlexCatalog, harvestDocMultiplier, parseNeuralwattModels } from "../src/core/flexCatalog";
import { parseFlexPerfView } from "../src/core/flexPerf";
import { parseFlexCatalogCards } from "../src/core/flexCatalogCards";
import { cardsFixtureHtml, perfFixtureHtml, v1FixtureDoc } from "./flexFixture";

const SOURCES = {
  v1: { url: "https://api.neuralwatt.com/v1/models", fetchedAt: "2026-09-18T08:00:00.000Z" },
  perf: { url: "https://portal.neuralwatt.com/energy-pricing?view=performance", fetchedAt: "2026-09-18T08:01:00.000Z" },
  cards: { url: "https://portal.neuralwatt.com/models", fetchedAt: "2026-09-18T08:02:00.000Z" },
};

function buildDump(opts: { board?: readonly string[]; boardPreview?: readonly string[] } = {}): string {
  const doc = parseNeuralwattModels(v1FixtureDoc());
  const perf = parseFlexPerfView(perfFixtureHtml());
  const boardSlugs = new Set(opts.board ?? []);
  const entries = buildFlexCatalog(doc, perf, null, null, boardSlugs);
  return buildFlexDiagnostics({
    entries,
    sources: SOURCES,
    v1Hash: "abcdef0123456789abcdef",
    perfHash: "fedcba9876543210fedcba",
    cardsHash: "0123456789abcdef01234567",
    harvest: harvestDocMultiplier(doc),
    boardPreviewSlugs: new Set(opts.boardPreview ?? []),
    boardSlugs,
  });
}

describe("flexDiagnostics.buildFlexDiagnostics", () => {
  it("D1 header names all three documents with fetchedAt + hash prefixes and the harvest result", () => {
    const dump = buildDump();
    assert.ok(dump.includes("https://api.neuralwatt.com/v1/models"));
    assert.ok(dump.includes("https://portal.neuralwatt.com/energy-pricing?view=performance"));
    assert.ok(dump.includes("portal cards: https://portal.neuralwatt.com/models (fetched 2026-09-18T08:02:00.000Z; sha256 0123456789ab)"));
    assert.ok(dump.includes("fetched 2026-09-18T08:00:00.000Z"));
    assert.ok(dump.includes("fetched 2026-09-18T08:01:00.000Z"));
    assert.ok(dump.includes("sha256 abcdef012345"));
    assert.ok(dump.includes("sha256 fedcba987654"));
    assert.ok(dump.includes("multiplier harvest: distinct=[0.65] value=0.65"));
    assert.ok(dump.includes("board slugs: 0 | board preview slugs: 0"));
    assert.ok(dump.includes("rows: 10"));
  });

  it("D2 per-row evidence: membership docs, pricing values + provenance, multiplier + rung, preview", () => {
    const dump = buildDump();
    assert.ok(dump.includes("- kimi-k3-fast-flex (base kimi-k3-fast, membership perf-lane)"));
    assert.ok(dump.includes('perf view lane "kimi-k3-fast"'));
    assert.ok(dump.includes("pricing: v1-derived in=1.95 out=9.75 cached=0.195"));
    assert.ok(dump.includes("multiplier: 0.65 (family-sibling)"));
    assert.ok(dump.includes("preview: false"));

    assert.ok(dump.includes("- kimi-k2.7-code-flex (base kimi-k2.7-code, membership both)"));
    assert.ok(dump.includes('perf view lane "kimi-k2.7-code"'));
    assert.ok(dump.includes('/v1/models alias "kimi-k2.7-code-flex"'));
    assert.ok(dump.includes("pricing: v1-alias in=0.6175 out=2.6 cached=0.06175"));
  });

  it("D3 TBD rows report the exact reason", () => {
    const dump = buildDump();
    assert.ok(dump.includes("- deepseek-v4.1-flash-flex (base deepseek-v4.1-flash, membership perf-lane)"));
    assert.ok(dump.includes("pricing: tbd (base standard entry absent from /v1/models) in=- out=- cached=-"));
    assert.ok(dump.includes("preview: true"));
  });

  it("D6 a portal-card priced row carries the display-rounding caveat", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const perf = parseFlexPerfView(perfFixtureHtml());
    const cards = parseFlexCatalogCards(cardsFixtureHtml());
    const entries = buildFlexCatalog(doc, perf, cards, null, new Set());
    const dump = buildFlexDiagnostics({
      entries,
      sources: SOURCES,
      v1Hash: "abcdef0123456789abcdef",
      perfHash: "fedcba9876543210fedcba",
      cardsHash: "0123456789abcdef01234567",
      harvest: harvestDocMultiplier(doc),
      boardPreviewSlugs: new Set(),
      boardSlugs: new Set(),
    });
    assert.ok(
      dump.includes(
        "pricing: portal-card in=0.0975 out=0.39 cached=0.013 (input exact; output display-rounded)",
      ),
    );
    // The exact v1-alias rows carry no caveat.
    assert.ok(dump.includes("pricing: v1-alias in=0.6175 out=2.6 cached=0.06175\n"));
  });

  it("D4 MISMATCH lines appear only when the board and the perf view disagree on a BOARD model", () => {
    // Preview row present on the board with no board preview marker -> mismatch.
    const disagree = buildDump({ board: ["deepseek-v4.1-flash"], boardPreview: [] });
    assert.ok(disagree.includes("MISMATCH: board preview=false but perf view chip=true (report-only)"));

    // Board marks a model preview that the perf view does not -> mismatch too.
    const inverse = buildDump({ board: ["kimi-k3"], boardPreview: ["kimi-k3"] });
    assert.ok(inverse.includes("MISMATCH: board preview=true but perf view chip=false (report-only)"));

    // Agreement + absent-from-board rows produce no mismatch noise.
    const agree = buildDump({ board: ["deepseek-v4.1-flash"], boardPreview: ["deepseek-v4.1-flash"] });
    assert.equal(agree.includes("MISMATCH"), false);
    const noBoard = buildDump();
    assert.equal(noBoard.includes("MISMATCH"), false);
  });

  it("D5 empty entry set still dumps a valid header", () => {
    const dump = buildFlexDiagnostics({
      entries: [],
      sources: { v1: null, perf: null, cards: null },
      v1Hash: null,
      perfHash: null,
      cardsHash: null,
      harvest: { distinct: [], value: null },
      boardPreviewSlugs: new Set(),
    });
    assert.ok(dump.includes("rows: 0"));
    assert.ok(dump.includes("multiplier harvest: distinct=[] value=unavailable"));
    assert.ok(dump.includes("portal cards: (none)"));
    assert.ok(dump.includes("(none)"));
  });
});
