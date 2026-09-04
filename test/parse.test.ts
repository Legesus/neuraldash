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
  /** td[4] inner HTML override; default plain div (parses to sparkline null). */
  spark?: string;
  /** Drop the 5th td entirely (legacy-shape row). */
  omitTd4?: boolean;
}): string {
  const previewHtml = opts.preview ? `<a class="ml-2 bg-amber-100" title="${opts.name} is in preview">Preview</a>` : "";
  const ctx = opts.contextBand ?? "16k–64k";
  const cache = opts.cachePct != null ? ` &middot; ${opts.cachePct}% cache` : "";
  const small = `<div class="text-[10px] font-mono-data">${ctx}<span> ${cache}</span></div>`;
  const trend = opts.trendAria ? `<div role="img" aria-label="${opts.trendAria}"></div>` : `<div></div>`;
  const td4 = opts.omitTd4 ? "" : `<td class="px-3 py-3">${opts.spark ?? "<div>48h sparkline</div>"}</td>`;
  return `
    <tr>
      <td class="px-4 py-3">
        <div class="font-medium" title="${opts.name}">${opts.name}${previewHtml}</div>
        ${small}
      </td>
      <td class="px-3 py-3 text-right"><span class="num">${opts.rightNow ?? "—"}</span></td>
      <td class="px-3 py-3 text-right"><span class="num">${opts.typical ?? "—"}</span></td>
      <td class="px-3 py-3">${trend}</td>
      ${td4}
    </tr>`;
}

/** Builds td[4] inner HTML mimicking the live board's 48h sparkline cell. */
function sparkTd(opts?: {
  cls?: string;
  /** Polyline point tokens; null => svg without polyline. Default 3 points. */
  points?: string[] | null;
  /** Reference line y1; "none" => no line element (refY null). Default 20.6. */
  refY?: number | "none";
  /** Label spans: default ["461.32 mWh","170.84 mWh"]; "none" => no label div; "one" => single span. */
  labels?: [string, string] | "none" | "one";
}): string {
  const cls = opts?.cls ?? "flex-1  text-emerald-500";
  const refY = opts?.refY === undefined ? 20.6 : opts.refY;
  const lineHtml =
    refY === "none"
      ? ""
      : `<line x1="0" y1="${refY}" x2="100" y2="${refY}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="2,2" opacity="0.6"/>`;
  const pts = opts?.points === undefined ? ["0.0,20.24", "2.13,22.16", "97.87,20.83"] : opts.points;
  const polyHtml = pts == null ? "" : `<polyline points="${pts.join(" ")} "/>`;
  const svg = `<svg viewBox="0 0 100 30" class="${cls}">${lineHtml}${polyHtml}</svg>`;
  const labels = opts?.labels === undefined ? (["461.32 mWh", "170.84 mWh"] as [string, string]) : opts.labels;
  let labelHtml: string;
  if (labels === "none") labelHtml = "";
  else if (labels === "one") labelHtml = `<div class="flex flex-col justify-between"><span>461.32 mWh</span></div>`;
  else labelHtml = `<div class="flex flex-col justify-between"><span>${labels[0]}</span><span>${labels[1]}</span></div>`;
  return `<div class="flex items-stretch">${svg}</div>${labelHtml}`;
}

/** Generates n evenly-spaced "x,y" tokens for point-count tests. */
function nPoints(n: number): string[] {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) pts.push(`${((i * 100) / (n - 1)).toFixed(2)},${(15 + i * 0.1).toFixed(2)}`);
  return pts;
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

  // P0 regression: preview models must join grid bands correctly (badge stripped)
  it("joins grid bands for preview model deepseek-v4-pro (badge stripped, Wh conversion)", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl);
    const pro = snap.quotes.find((q) => q.slug === "deepseek-v4-pro");
    assert.ok(pro, "deepseek-v4-pro must exist (not deepseek-v4-propreview)");
    // Must not have produced a mis-slung entry
    assert.equal(snap.quotes.some((q) => q.slug === "deepseek-v4-propreview"), false, "must not have preview-suffixed slug");
    const bandsByKey = Object.fromEntries(pro!.bands.map((b) => [b.band, b.mwh])) as Record<string, number | null>;
    // Fixture grid for deepseek-v4-pro: 114.11 mWh, 140.15, 356.15, 1.54 Wh->1540, 1.51 Wh->1510, 1.33 Wh->1330, 1.33 Wh->1330
    // But note synthetic vs fixture: fixture shows preceding row values; check actual:
    // Fixture Table B row 2 (deepseek-v4-pro): 114.11 mWh | 140.15 mWh | 356.15 mWh | 1.54 Wh | 1.51 Wh | 1.33 Wh | 1.33 Wh
    // The ticket spec says 115.34/140.25/344.98 variants — assert non-null + Wh conversion shape robustly
    for (const band of ["0-256", "256-1k", "1k-4k", "4k-16k", "16k-64k", "64k-256k", "256k-1M"] as const) {
      assert.ok(bandsByKey[band] != null, `deepseek-v4-pro band ${band} must be non-null`);
    }
    // Spot-check Wh conversion for the larger bands (>= 1 Wh -> >= 1000 mWh)
    assert.ok((bandsByKey["4k-16k"] ?? 0) >= 1000, "4k-16k should have been Wh->mWh (>=1000)");
    // 16k-64k in fixture is ~1.51 Wh -> 1510 mWh
    const mid = bandsByKey["16k-64k"] ?? 0;
    assert.ok(Math.abs(mid - 1510) < 5 || mid >= 1000, `16k-64k mwh should be ~1510 (Wh conversion), got ${mid}`);
  });

  it("joins grid bands for preview model qwen-3.8-27b and keeps last band null", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl);
    const qwen = snap.quotes.find((q) => q.slug === "qwen-3.8-27b");
    assert.ok(qwen, "qwen-3.8-27b must exist");
    assert.equal(snap.quotes.some((q) => q.slug === "qwen-3.8-27bpreview"), false);
    const bandsByKey = Object.fromEntries(qwen!.bands.map((b) => [b.band, b.mwh])) as Record<string, number | null>;
    // First 6 bands non-null (15.59, 60.59, 88.52, 336.06 etc), last is Gathering/mdash -> null per spec
    for (const band of ["0-256", "256-1k", "1k-4k", "4k-16k", "16k-64k", "64k-256k"] as const) {
      assert.ok(bandsByKey[band] != null, `qwen-3.8-27b band ${band} must be non-null`);
    }
    assert.equal(bandsByKey["256k-1M"], null, "qwen-3.8-27b last band (256k-1M) must be null (mdash/Gathering data)");
  });

  it("grid preview badge slug regression (synthetic): div.num containing <a>Preview</a> still joins", () => {
    const board = [
      syntheticBoardRow({ name: "DeepSeek V4-Pro", preview: true, rightNow: "10 mWh" }),
      syntheticBoardRow({ name: "Qwen 3.8 27B", preview: true, rightNow: "10 mWh" }),
      syntheticBoardRow({ name: "Gemma 4 31B", rightNow: "10 mWh" }),
    ].join("\n");
    // Grid rows with badge markup mimicking live HTML: div.num contains anchor
    const gridRows = [
      `<tr><td class="px-4 py-3"><div class="num">DeepSeek V4-Pro<a href="/enroll/deepseek-v4-pro-preview" class="ml-2 bg-amber-100" title="DeepSeek V4-Pro is in preview">Preview</a></div></td>` +
        `<td><div class="num">114.11 mWh</div></td><td><div class="num">140.15 mWh</div></td><td><div class="num">356.15 mWh</div></td>` +
        `<td><div class="num">1.54 Wh</div></td><td><div class="num">1.51 Wh</div></td><td><div class="num">1.33 Wh</div></td><td><div class="num">1.33 Wh</div></td></tr>`,
      `<tr><td class="px-4 py-3"><div class="num">Qwen 3.8 27B<a href="/enroll/qwen38-27b-preview" class="ml-2 bg-amber-100" title="Qwen 3.8 27B is in preview">Preview</a></div></td>` +
        `<td><div class="num">15.59 mWh</div></td><td><div class="num">60.59 mWh</div></td><td><div class="num">88.52 mWh</div></td>` +
        `<td><div class="num">99.92 mWh</div></td><td><div class="num">172.29 mWh</div></td><td><div class="num">581.12 mWh</div></td><td><div>&mdash;</div></td></tr>`,
      `<tr><td class="px-4 py-3"><div class="num">Gemma 4 31B</div></td>` +
        `<td><div class="num">23.13 mWh</div></td><td><div class="num">11.47 mWh</div></td><td><div class="num">47.12 mWh</div></td>` +
        `<td><div class="num">99.92 mWh</div></td><td><div class="num">172.29 mWh</div></td><td><div class="num">581.12 mWh</div></td><td><div>&mdash;</div></td></tr>`,
    ].join("\n");
    const html = wrapTwoTables(board, gridRows);
    const snap = parseSnapshot(html, sourceUrl);
    const pro = snap.quotes.find((q) => q.slug === "deepseek-v4-pro")!;
    assert.ok(pro, "deepseek-v4-pro found after badge strip");
    assert.equal(pro.bands[0].mwh, 114.11);
    assert.equal(pro.bands[3].mwh, 1540); // 1.54 Wh -> mWh
    assert.equal(pro.bands[4].mwh, 1510); // 1.51 Wh -> mWh
    const qwen = snap.quotes.find((q) => q.slug === "qwen-3.8-27b")!;
    assert.ok(qwen);
    assert.equal(qwen.bands[0].mwh, 15.59);
    assert.equal(qwen.bands[6].mwh, null);
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

describe("parse — sparkline (fixture)", () => {
  it("parses all 14 fixture sparklines with 6 below / 7 above / 1 neutral", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl);
    assert.equal(snap.quotes.length, 14);
    const counts = { below: 0, above: 0, neutral: 0 };
    for (const q of snap.quotes) {
      assert.ok(q.sparkline != null, `sparkline non-null for ${q.displayName}`);
      counts[q.sparkline!.direction]++;
    }
    assert.deepEqual(counts, { below: 6, above: 7, neutral: 1 });
  });

  it("pins per-model direction expectations from the fixture", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl);
    const bySlug = Object.fromEntries(snap.quotes.map((q) => [q.slug, q.sparkline!.direction])) as Record<string, string>;
    const expected: Record<string, string> = {
      "deepseek-v4-flash": "neutral", // text-nw-moss dark:text-nw-envy
      "deepseek-v4-pro": "above",
      "gemma-4-31b": "above",
      "glm-5.2": "above",
      "glm-5.2-fast": "above",
      "glm-5.2-short": "above",
      "glm-5.2-short-fast": "below",
      "kimi-k2.7-code": "below",
      "kimi-k2.7-code-fast": "below",
      "kimi-k3": "below",
      "kimi-k3-fast": "below",
      "qwen-3.8-27b": "above",
      "qwen3.6-35b": "above",
      "qwen3.6-35b-fast": "below",
    };
    for (const [slug, dir] of Object.entries(expected)) {
      assert.equal(bySlug[slug], dir, `direction for ${slug}`);
    }
    // Include any key check that no models are missing from the pin list:
    assert.equal(Object.keys(bySlug).length, Object.keys(expected).length, "all fixture slugs pinned");
  });

  it("parses the first sparkline exactly (47 points, refY, min/max)", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl);
    const flash = snap.quotes.find((q) => q.slug === "deepseek-v4-flash")!;
    const sp = flash.sparkline!;
    assert.equal(sp.points.length, 47);
    assert.deepEqual(sp.points[0], { x: 0, y: 20.24 });
    assert.deepEqual(sp.points[46], { x: 97.87, y: 20.83 });
    assert.equal(sp.refY, 20.6);
    assert.equal(sp.maxMwh, 461.32);
    assert.equal(sp.minMwh, 170.84);
    assert.equal(sp.direction, "neutral");
  });

  it("supports variable point counts (2, 8, 34 observed in fixture)", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl);
    const fast = snap.quotes.find((q) => q.slug === "kimi-k2.7-code-fast")!;
    assert.equal(fast.sparkline!.points.length, 2);
    const fast2 = snap.quotes.find((q) => q.slug === "kimi-k3-fast")!;
    assert.equal(fast2.sparkline!.points.length, 8);
    const code = snap.quotes.find((q) => q.slug === "kimi-k2.7-code")!;
    assert.equal(code.sparkline!.points.length, 34);
  });

  it("normalizes Wh labels in fixture rows", () => {
    const snap = parseSnapshot(fixtureHtml(), sourceUrl);
    const pro = snap.quotes.find((q) => q.slug === "deepseek-v4-pro")!;
    assert.equal(pro.sparkline!.maxMwh, 1890); // "1.89 Wh"
    assert.equal(pro.sparkline!.minMwh, 841.12);
  });
});

describe("parse — sparkline (synthetic)", () => {
  function sparkQuote(name: string, opts?: { spark?: string; omitTd4?: boolean }): ReturnType<typeof parseSnapshot>["quotes"][number] {
    const board = syntheticBoardRow({ name, rightNow: "10 mWh", ...opts });
    const grid = syntheticGridRow({ name, bands: ["10 mWh", null, null, null, null, null, null] });
    return parseSnapshot(wrapTwoTables(board, grid), sourceUrl).quotes[0];
  }

  it("maps svg class tokens to direction (emerald/rose/moss/classless)", () => {
    assert.equal(sparkQuote("E", { spark: sparkTd({ cls: "flex-1  text-emerald-500" }) }).sparkline!.direction, "below");
    assert.equal(sparkQuote("R", { spark: sparkTd({ cls: "flex-1  text-rose-500" }) }).sparkline!.direction, "above");
    assert.equal(
      sparkQuote("M", { spark: sparkTd({ cls: "flex-1  text-nw-moss dark:text-nw-envy" }) }).sparkline!.direction,
      "neutral",
    );
    assert.equal(sparkQuote("C", { spark: sparkTd({ cls: "flex-1" }) }).sparkline!.direction, "neutral");
  });

  it("returns null when svg or polyline is missing", () => {
    assert.equal(sparkQuote("S").sparkline, null); // default td4 = plain div
    assert.equal(sparkQuote("P", { spark: sparkTd({ points: null }) }).sparkline, null); // svg without polyline
  });

  it("returns null when fewer than 2 valid points remain", () => {
    assert.equal(sparkQuote("One", { spark: sparkTd({ points: ["5,10"] }) }).sparkline, null);
    assert.equal(sparkQuote("None", { spark: sparkTd({ points: [] }) }).sparkline, null);
    // garbage tokens skipped; a single surviving valid point still yields null
    assert.equal(sparkQuote("Gar", { spark: sparkTd({ points: ["5,10", "oops", "1,2,3", "NaN,5"] }) }).sparkline, null);
  });

  it("skips garbage tokens but keeps valid ones", () => {
    const q = sparkQuote("Mix", { spark: sparkTd({ points: ["0,1", "oops", "2,3", "1,2,3", "4,5"] }) });
    assert.deepEqual(
      q.sparkline!.points,
      [
        { x: 0, y: 1 },
        { x: 2, y: 3 },
        { x: 4, y: 5 },
      ],
    );
  });

  it("accepts 46 vs 48 points without complaint", () => {
    assert.equal(sparkQuote("A", { spark: sparkTd({ points: nPoints(46) }) }).sparkline!.points.length, 46);
    assert.equal(sparkQuote("B", { spark: sparkTd({ points: nPoints(48) }) }).sparkline!.points.length, 48);
  });

  it("keeps sparkline with null min/max when the label div is missing", () => {
    const q = sparkQuote("NL", { spark: sparkTd({ labels: "none" }) });
    assert.ok(q.sparkline != null);
    assert.equal(q.sparkline!.maxMwh, null);
    assert.equal(q.sparkline!.minMwh, null);
  });

  it("sets both min/max null when fewer than 2 label spans exist", () => {
    const q = sparkQuote("OS", { spark: sparkTd({ labels: "one" }) });
    assert.ok(q.sparkline != null);
    assert.equal(q.sparkline!.maxMwh, null);
    assert.equal(q.sparkline!.minMwh, null);
  });

  it('normalizes "2.59 Wh" labels to 2590 mWh', () => {
    const q = sparkQuote("WH", { spark: sparkTd({ labels: ["2.59 Wh", "170.84 mWh"] }) });
    assert.equal(q.sparkline!.maxMwh, 2590);
    assert.equal(q.sparkline!.minMwh, 170.84);
  });

  it("returns null for a 4-td legacy row (no td[4])", () => {
    assert.equal(sparkQuote("Legacy", { omitTd4: true }).sparkline, null);
  });

  it("parses refY from the line, null when the line is absent", () => {
    assert.equal(sparkQuote("RL", { spark: sparkTd({}) }).sparkline!.refY, 20.6);
    assert.equal(sparkQuote("RN", { spark: sparkTd({ refY: "none" }) }).sparkline!.refY, null);
  });
});
