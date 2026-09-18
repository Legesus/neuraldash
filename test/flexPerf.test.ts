import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFlexPerfView } from "../src/core/flexPerf";
import {
  FLEX_MARKER,
  PERF_LANES,
  energyTable,
  laneRow,
  metricsTable,
  perfFixtureHtml,
  secondTableRow,
  previewChip,
  speedMarker,
  standardRow,
} from "./flexFixture";

describe("flexPerf.parseFlexPerfView", () => {
  it("P1 extracts all 11 lane rows with slug + document family", () => {
    const doc = parseFlexPerfView(perfFixtureHtml());
    assert.ok(doc);
    assert.deepEqual(
      doc!.lanes.map((l) => [l.slug, l.family]),
      PERF_LANES.map((l) => [l.slug, l.family]),
    );
  });

  it("P2 lanes keep ONLY identity/classification fields (volatile data dropped at parse time)", () => {
    const doc = parseFlexPerfView(perfFixtureHtml());
    for (const lane of doc!.lanes) {
      assert.deepEqual(Object.keys(lane).sort(), ["family", "flex", "preview", "slug"]);
    }
  });

  it("P3 flex marker: exactly the 10 flex-tagged lanes; the SPEED lane (raw-slug invocation) is flex=false", () => {
    const doc = parseFlexPerfView(perfFixtureHtml());
    const flexSlugs = doc!.lanes.filter((l) => l.flex).map((l) => l.slug);
    assert.deepEqual(flexSlugs, [
      "deepseek-v4-flash",
      "deepseek-v4.1-flash",
      "glm-5.3",
      "glm-5.3-flash",
      "kimi-k2.7-code",
      "kimi-k3",
      "kimi-k3-fast",
      "qwen-3.8-27b",
      "qwen3.6-35b",
      "qwen3.6-35b-fast",
    ]);
    const speed = doc!.lanes.find((l) => l.slug === "deepseek-v4-flash-speed")!;
    assert.equal(speed.flex, false);
  });

  it("P4 preview chip: the Standard sibling row's chip marks the lane's model as preview", () => {
    const doc = parseFlexPerfView(perfFixtureHtml());
    const bySlug = new Map(doc!.lanes.map((l) => [l.slug, l]));
    assert.equal(bySlug.get("deepseek-v4.1-flash")!.preview, true);
    for (const lane of doc!.lanes) {
      if (lane.slug !== "deepseek-v4.1-flash") assert.equal(lane.preview, false, `unexpected preview on ${lane.slug}`);
    }
  });

  it("P5 preview chip: a chip inside the LANE row itself is also detected (semantic title probe)", () => {
    const html = metricsTable([
      laneRow("acme-flash", "Acme Flash", FLEX_MARKER, previewChip("Acme Flash")),
      laneRow("acme-mini", "Acme Mini", FLEX_MARKER),
    ]);
    const doc = parseFlexPerfView(html);
    assert.equal(doc!.lanes.find((l) => l.slug === "acme-flash")!.preview, true);
    assert.equal(doc!.lanes.find((l) => l.slug === "acme-mini")!.preview, false);
  });

  it("P6 SECOND-TABLE NON-LEAK: chips in the 'Average energy per request' table never affect lane status", () => {
    const html = metricsTable([
      standardRow("kimi-k3", "Kimi K3"), // no chip in table 1
      laneRow("kimi-k3", "Kimi K3", FLEX_MARKER),
      standardRow("deepseek-v4.1-flash", "DeepSeek V4.1 Flash", previewChip("DeepSeek V4.1 Flash")),
      laneRow("deepseek-v4.1-flash", "DeepSeek V4.1 Flash", FLEX_MARKER),
    ]);
    // The second table repeats chips and adds chips for lane models that have none in table 1.
    const table2 = energyTable([
      secondTableRow("Kimi K3", previewChip("Kimi K3")),
      secondTableRow("Ghost Model", previewChip("Ghost Model")),
    ]);
    const doc = parseFlexPerfView(`<html><body>${html}${table2}</body></html>`);
    assert.ok(doc);
    const bySlug = new Map(doc!.lanes.map((l) => [l.slug, l]));
    assert.equal(bySlug.get("kimi-k3")!.preview, false);
    assert.equal(bySlug.get("deepseek-v4.1-flash")!.preview, true);
    assert.deepEqual([...bySlug.keys()].sort(), ["deepseek-v4.1-flash", "kimi-k3"]);
  });

  it("P7 flex marker fallback: the flex tier tag's title still identifies the lane", () => {
    const tagOnly = `<span class="nw-tag nw-tag-sm nw-tag-blue" title="Wait for spare capacity for an energy discount.">Flex tier</span>`;
    const html = metricsTable([laneRow("acme-pro", "Acme Pro", tagOnly)]);
    const doc = parseFlexPerfView(html);
    assert.equal(doc!.lanes[0]!.flex, true);
  });

  it("P8 malformed / lane-less documents -> null (caller keeps last-known)", () => {
    assert.equal(parseFlexPerfView(""), null);
    assert.equal(parseFlexPerfView("   "), null);
    assert.equal(parseFlexPerfView("<html><body><p>upstream error page</p></body></html>"), null);
    assert.equal(parseFlexPerfView(metricsTable([standardRow("acme", "Acme")])), null);
    // Second table alone is not lane evidence either.
    assert.equal(parseFlexPerfView(energyTable([secondTableRow("Acme", previewChip("Acme"))])), null);
  });

  it("P9 rows with empty lane_id values are skipped; duplicate lanes dedupe (first wins)", () => {
    const html = metricsTable([
      laneRow("", "Empty", FLEX_MARKER),
      laneRow("dup", "Dup One", FLEX_MARKER),
      laneRow("dup", "Dup Two", FLEX_MARKER),
      laneRow("acme", "Acme", FLEX_MARKER),
    ]);
    const doc = parseFlexPerfView(html);
    assert.deepEqual(
      doc!.lanes.map((l) => [l.slug, l.family]),
      [
        ["dup", "Dup One"],
        ["acme", "Acme"],
      ],
    );
  });

  it("P10 a lane row without data-family-row yields family=null", () => {
    const html = metricsTable([`<tr data-perf-lane="bare">${FLEX_MARKER}</tr>`]);
    const doc = parseFlexPerfView(html);
    assert.equal(doc!.lanes[0]!.family, null);
    assert.equal(doc!.lanes[0]!.flex, true);
  });

  it("P11 display names (whitespace) are never accepted as Standard-row slugs", () => {
    const html = metricsTable([
      `<tr data-family-row="Acme"><td><div title="Acme Flash">Acme Flash${previewChip("Acme Flash")}</div></td></tr>`,
      laneRow("acme-flash", "Acme", FLEX_MARKER),
    ]);
    const doc = parseFlexPerfView(html);
    assert.equal(doc!.lanes[0]!.preview, false); // "Acme Flash" rejected; no slug match
  });
});
