import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { parseSnapshot } from "../src/core/parse";
import { ParseError } from "../src/core/types";

const fixturePath = path.resolve(__dirname, "../../test/fixtures/energy_neuraldash.html");
const sourceUrl = "https://portal.neuralwatt.com/energy-pricing";

function fixtureHtml(): string {
  return fs.readFileSync(fixturePath, "utf8");
}

// --- Helpers for synthetic ---
function syntheticBoardRow(opts: {
  name: string;
  rightNow?: string;
  typical?: string;
  trendAria?: string;
  preview?: boolean;
  contextBand?: string;
  cachePct?: number;
}): string {
  const previewHtml = opts.preview ? `<a class="ml-2 bg-amber-100" title="${opts.name} is in preview">Preview</a>` : "";
  const ctx = opts.contextBand ?? "16k–64k";
  const cache = opts.cachePct != null ? ` &middot; ${opts.cachePct}% cache` : "";
  const small = `<div class="text-[10px] font-mono-data">${ctx}<span> ${cache}</span></div>`;
  const trend = opts.trendAria ? `<div role="img" aria-label="${opts.trendAria}"></div>` : `<div></div>`;
  return `
    <tr>
      <td class="px-4 py-3">
        <div class="font-medium" title="${opts.name}">${opts.name}${previewHtml}</div>
        ${small}
      </td>
      <td class="px-3 py-3 text-right"><span class="num">${opts.rightNow ?? "—"}</span></td>
      <td class="px-3 py-3 text-right"><span class="num">${opts.typical ?? "—"}</span></td>
      <td class="px-3 py-3">${trend}</td>
      <td class="px-3 py-3"><div>48h sparkline</div></td>
    </tr>`;
}

function syntheticGridRow(opts: {
  name: string;
  bands: (string | null)[];
  shares?: (string | null)[];
}): string {
  const bandCells = opts.bands
    .map((mwh, idx) => {
      const share = opts.shares?.[idx] ?? null;
      if (mwh == null) {
        return `<td class="px-3 py-3"><div>&mdash;</div></td>`;
      }
      const shareHtml = share ? `<div class="text-[10px] num">${share}</div>` : "";
      return `<td class="px-3 py-3"><div class="num">${mwh}</div>${shareHtml}</td>`;
    })
    .join("\n");
  return `
    <tr>
      <td class="px-4 py-3"><div class="num">${opts.name}</div></td>
      ${bandCells}
    </tr>`;
}

function wrapTwoTables(boardRows: string, gridRows: string, opts?: { theadless?: boolean }): string {
  if (opts?.theadless) {
    return `
<html><body>
<table>
  <tr><th>Model</th><th>Right now</th><th>7-day typical</th><th>vs 7-day</th><th>48h trend</th></tr>
  ${boardRows}
</table>
<table>
  <tr><th>Model</th><th>0–256</th><th>256–1k</th><th>1k–4k</th><th>4k–16k</th><th>16k–64k</th><th>64k–256k</th><th>256k–1M</th></tr>
  ${gridRows}
</table>
</body></html>`;
  }
  return `
<html><body>
<table>
  <thead><tr><th>Model</th><th>Right now</th><th>7-day typical</th><th>vs 7-day</th><th>48h trend</th></tr></thead>
  <tbody>${boardRows}</tbody>
</table>
<table>
  <thead><tr><th>Model</th><th>0–256</th><th>256–1k</th><th>1k–4k</th><th>4k–16k</th><th>16k–64k</th><th>64k–256k</th><th>256k–1M</th></tr></thead>
  <tbody>${gridRows}</tbody>
</table>
</body></html>`;
}

describe("parse — fixture (live HTML)", () => {
  it("finds >=14 quotes and both tables", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl, "2026-08-28T00:00:00.000Z");
    assert.ok(snap.quotes.length >= 14, `expected >=14 quotes, got ${snap.quotes.length}`);
    assert.equal(snap.sourceUrl, sourceUrl);
    // every quote must have 7 bands (the grid was found)
    for (const q of snap.quotes) {
      assert.equal(q.bands.length, 7, `bands length for ${q.displayName}`);
    }
  });

  it("reads displayName from title attr", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl);
    const deep = snap.quotes.find((q) => q.slug === "deepseek-v4-flash");
    assert.ok(deep, "deepseek-v4-flash found");
    assert.equal(deep!.displayName, "DeepSeek V4 Flash");
  });

  it("sets preview flag for DeepSeek V4-Pro and Qwen 3.8 27B", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl);
    const pro = snap.quotes.find((q) => q.slug === "deepseek-v4-pro");
    const qwen38 = snap.quotes.find((q) => q.slug === "qwen-3.8-27b");
    assert.ok(pro, "deepseek-v4-pro found");
    assert.equal(pro!.isPreview, true);
    assert.ok(qwen38, "qwen-3.8-27b found");
    assert.equal(qwen38!.isPreview, true);
    const flash = snap.quotes.find((q) => q.slug === "deepseek-v4-flash");
    assert.equal(flash!.isPreview, false);
  });

  it("parses contextBand and cachePct", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl);
    const flash = snap.quotes.find((q) => q.slug === "deepseek-v4-flash")!;
    assert.ok(flash.contextBand, "contextBand present");
    // format normalized to hyphen
    assert.match(flash.contextBand!, /16k-64k/);
    assert.equal(flash.cachePct, 88);
  });

  it("parses right-now and typical with ~ stripped and normalization", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl);
    const flash = snap.quotes.find((q) => q.slug === "deepseek-v4-flash")!;
    assert.equal(flash.rightNowMwh, 245.48);
    assert.equal(flash.typicalMwh, 218.01);
  });

  it("joins bands by slug and marks known missing band as null", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl);
    const gemma = snap.quotes.find((q) => q.slug === "gemma-4-31b");
    assert.ok(gemma, "gemma-4-31b found");
    const band256 = gemma!.bands.find((b) => b.band === "256k-1M");
    assert.ok(band256, "256k-1M band present");
    assert.equal(band256!.mwh, null, "Gemma 256k-1M should be null (Gathering data / mdash)");
  });

  it("parses share %", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl);
    const flash = snap.quotes.find((q) => q.slug === "deepseek-v4-flash")!;
    const b0 = flash.bands.find((b) => b.band === "0-256")!;
    assert.ok(b0.sharePct != null, "sharePct present");
    assert.equal(b0.sharePct, 2.2);
  });
});

describe("parse — synthetic edge cases", () => {
  it("parses trend inline / above / below", () => {
    const board = [
      syntheticBoardRow({ name: "Model A", trendAria: "1% in line with the 7-day average" }),
      syntheticBoardRow({ name: "Model B", trendAria: "102% above the 7-day average" }),
      syntheticBoardRow({ name: "Model C", trendAria: "79% below the 7-day average" }),
    ].join("\n");
    const grid = [
      syntheticGridRow({ name: "Model A", bands: ["10 mWh", "10 mWh", "10 mWh", "10 mWh", "10 mWh", "10 mWh", "10 mWh"] }),
      syntheticGridRow({ name: "Model B", bands: ["10 mWh", "10 mWh", "10 mWh", "10 mWh", "10 mWh", "10 mWh", "10 mWh"] }),
      syntheticGridRow({ name: "Model C", bands: ["10 mWh", "10 mWh", "10 mWh", "10 mWh", "10 mWh", "10 mWh", "10 mWh"] }),
    ].join("\n");
    const html = wrapTwoTables(board, grid);
    const snap = parseSnapshot(html, sourceUrl);
    const a = snap.quotes.find((q) => q.displayName === "Model A")!;
    const b = snap.quotes.find((q) => q.displayName === "Model B")!;
    const c = snap.quotes.find((q) => q.displayName === "Model C")!;
    assert.deepEqual(a.trend, { pct: 1, direction: "inline" });
    assert.deepEqual(b.trend, { pct: 102, direction: "above" });
    assert.deepEqual(c.trend, { pct: 79, direction: "below" });
  });

  it("normalizes Wh → ×1e3", () => {
    const board = syntheticBoardRow({ name: "Wh Model", rightNow: "1.73 Wh", typical: "0.5 Wh" });
    const grid = syntheticGridRow({ name: "Wh Model", bands: ["1.73 Wh", null, null, null, null, null, null] });
    const snap = parseSnapshot(wrapTwoTables(board, grid), sourceUrl);
    const q = snap.quotes.find((x) => x.displayName === "Wh Model")!;
    assert.equal(q.rightNowMwh, 1730);
    assert.equal(q.typicalMwh, 500);
    assert.equal(q.bands[0].mwh, 1730);
  });

  it("normalizes kWh → ×1e6", () => {
    const board = syntheticBoardRow({ name: "KWh Model", rightNow: "0.002 kWh", typical: "0.001 kWh" });
    const grid = syntheticGridRow({ name: "KWh Model", bands: ["0.002 kWh", null, null, null, null, null, null] });
    const snap = parseSnapshot(wrapTwoTables(board, grid), sourceUrl);
    const q = snap.quotes.find((x) => x.displayName === "KWh Model")!;
    assert.equal(q.rightNowMwh, 2000);
    assert.equal(q.bands[0].mwh, 2000);
  });

  it("handles en-dash in context band normalization", () => {
    const board = syntheticBoardRow({ name: "Dash Model", contextBand: "16k\u201364k", cachePct: 10, rightNow: "10 mWh" });
    const grid = syntheticGridRow({ name: "Dash Model", bands: ["10 mWh", null, null, null, null, null, null] });
    const snap = parseSnapshot(wrapTwoTables(board, grid), sourceUrl);
    const q = snap.quotes.find((x) => x.displayName === "Dash Model")!;
    // parse normalizes en-dash to -
    assert.equal(q.contextBand, "16k-64k");
  });

  it("treats mdash / Gathering data as null band", () => {
    const board = syntheticBoardRow({ name: "Missing Model", rightNow: "10 mWh" });
    const grid = syntheticGridRow({ name: "Missing Model", bands: [null, null, null, null, null, null, null] });
    const html = wrapTwoTables(board, grid);
    // replace one null cell with explicit Gathering data title
    const htmlWithGathering = html.replace("&mdash;", '<div title="Gathering data">&mdash;</div>');
    const snap = parseSnapshot(htmlWithGathering, sourceUrl);
    const q = snap.quotes.find((x) => x.displayName === "Missing Model")!;
    for (const b of q.bands) assert.equal(b.mwh, null);
  });

  it("throws ParseError when no tables", () => {
    assert.throws(() => parseSnapshot("<html><body><p>no tables</p></body></html>", sourceUrl), (e: unknown) => e instanceof ParseError);
  });

  it("supports theadless tables (tr-minus-first fallback)", () => {
    const board = syntheticBoardRow({ name: "NoHead Model", rightNow: "12 mWh", typical: "10 mWh" });
    const grid = syntheticGridRow({ name: "NoHead Model", bands: ["12 mWh", "10 mWh", "9 mWh", "8 mWh", "7 mWh", "6 mWh", "5 mWh"] });
    const html = wrapTwoTables(board, grid, { theadless: true });
    const snap = parseSnapshot(html, sourceUrl);
    assert.equal(snap.quotes.length, 1);
    assert.equal(snap.quotes[0].displayName, "NoHead Model");
  });

  it("slugifies unknown names as fallback", () => {
    const board = syntheticBoardRow({ name: "My Unknown Model 9000!", rightNow: "10 mWh" });
    const grid = syntheticGridRow({ name: "My Unknown Model 9000!", bands: ["10 mWh", null, null, null, null, null, null] });
    const snap = parseSnapshot(wrapTwoTables(board, grid), sourceUrl);
    const q = snap.quotes[0];
    assert.equal(q.slug, "my-unknown-model-9000");
  });

  it("throws ParseError when board has 0 data rows", () => {
    const html = wrapTwoTables("", syntheticGridRow({ name: "X", bands: ["1 mWh", null, null, null, null, null, null] }));
    assert.throws(() => parseSnapshot(html, sourceUrl), (e: unknown) => e instanceof ParseError);
  });
});
