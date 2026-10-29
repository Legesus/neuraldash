import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { eciScoreTable, extractEciRows, matchEciRow, normalizeModelName, parseCsv, parseEciCsv, readZipEntry } from "../src/core/eciScores";
import type { EciRow } from "../src/core/eciScores";
import { mergedScores } from "../src/core/scores";
import type { ModelQuote } from "../src/core/types";

function zipOf(entries: Array<{ name: string; data: string; store?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data, "utf8");
    const body = e.store ? raw : deflateRawSync(raw);
    const name = Buffer.from(e.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.store ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.store ? 0 : 8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const CSV = [
  "Model,Display name,eci,eci_ci_low,eci_ci_high,date",
  "Alpha Two,Alpha Two,150.5,148,152,2026-08-01",
  '"Beta-3 (Mar 2026)","Beta-3 (Mar 2026)",140,138,142,2026-03-01',
  "Gamma 4 31B IT,Gamma 4 31B IT,130,128,132,2026-04-02",
  "Delta 2.6 35B-A3B,Delta 2.6 35B-A3B,120,118,122,2026-04-14",
  "Eps 5,Eps 5,110,108,112,2026-01-01",
  "Eps 5 Pro,Eps 5 Pro,115,113,117,2026-02-01",
  "Twin,Twin,100,98,102,2026-01-01",
  "Twin,Twin,101,99,103,2026-02-01",
].join("\n");

function rows(): EciRow[] {
  return parseEciCsv(CSV)!;
}

function quote(slug: string, displayName = slug, family: string | null = null): ModelQuote {
  return {
    displayName,
    slug,
    isPreview: false,
    contextBand: null,
    cachePct: null,
    rightNowMwh: 10,
    typicalMwh: 10,
    trend: null,
    family,
    bands: [],
    capturedAt: "2026-10-29T00:00:00Z",
  };
}

describe("eciScores — zip and csv", () => {
  it("reads deflated and stored entries and finds the eci csv by suffix", () => {
    const zip = zipOf([
      { name: "README.md", data: "hello" },
      { name: "plain.txt", data: "stored body", store: true },
      { name: "epoch_capabilities_index/eci_scores.csv", data: CSV },
    ]);
    assert.equal(readZipEntry(zip, (n) => n === "plain.txt")?.toString(), "stored body");
    assert.equal(readZipEntry(zip, (n) => n === "missing"), null);
    assert.equal(extractEciRows(zip)?.length, 8);
  });

  it("returns null for non-zip bytes", () => {
    assert.equal(readZipEntry(Buffer.from("not a zip at all, definitely not"), () => true), null);
    assert.equal(extractEciRows(Buffer.alloc(0)), null);
  });

  it("parses quoted fields, escaped quotes and CRLF", () => {
    assert.deepEqual(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\r\n'), [
      ["a", "b,c", 'd "e"'],
      ["1", "2", "3"],
    ]);
  });

  it("maps eci rows by header name and skips rows without a numeric eci", () => {
    const parsed = parseEciCsv("date,eci,Model\n2026-01-01,99.5,Foo\n2026-01-02,n/a,Bar\n")!;
    assert.deepEqual(parsed, [{ name: "Foo", displayName: "Foo", eci: 99.5, date: "2026-01-01" }]);
    assert.equal(parseEciCsv("Name,score\nx,1\n"), null);
  });
});

describe("eciScores — matching", () => {
  it("normalizes separators, case and parentheticals", () => {
    assert.equal(normalizeModelName("Beta-3 (Mar 2026)"), "beta3");
    assert.equal(normalizeModelName("alpha-two"), normalizeModelName("Alpha Two"));
    assert.equal(normalizeModelName("Delta 2.6 35B"), "delta2.635b");
  });

  it("matches by slug, then display name, then family", () => {
    assert.equal(matchEciRow(quote("alpha-two"), rows())?.via, "slug");
    assert.equal(matchEciRow(quote("x-1", "Alpha Two"), rows())?.via, "name");
    const fam = matchEciRow(quote("alpha-two-fast", "Alpha Two Fast", "Alpha Two"), rows());
    assert.equal(fam?.via, "family");
    assert.equal(fam?.row.eci, 150.5);
  });

  it("tolerates only structural suffixes and never guesses between variants", () => {
    assert.equal(matchEciRow(quote("gamma-4-31b"), rows())?.row.eci, 130);
    assert.equal(matchEciRow(quote("delta2.6-35b"), rows())?.row.eci, 120);
    assert.equal(matchEciRow(quote("eps-5"), rows())?.row.eci, 110);
    assert.equal(matchEciRow(quote("eps"), rows()), null);
    assert.equal(matchEciRow(quote("twin"), rows()), null);
    assert.equal(matchEciRow(quote("unknown-model"), rows()), null);
  });

  it("builds a score table with provenance and leaves unmatched slugs out", () => {
    const doc = { rows: rows(), fetchedAt: "2026-10-29T05:00:00Z", contentHash: "h" };
    const table = eciScoreTable([quote("alpha-two"), quote("a-fast", "A Fast", "Alpha Two"), quote("nope")], doc);
    assert.deepEqual(Object.keys(table).sort(), ["a-fast", "alpha-two"]);
    assert.equal(table["alpha-two"].source, "Epoch AI ECI · Alpha Two");
    assert.equal(table["a-fast"].source, "Epoch AI ECI · Alpha Two (family)");
    assert.equal(table["alpha-two"].asOf, "2026-10-29");
    assert.deepEqual(eciScoreTable([quote("alpha-two")], null), {});
  });

  it("live scores sit under bundled and override scores", () => {
    const live = { "alpha-two": { performanceScore: 1, source: "live", asOf: "2026-10-29" } };
    const merged = mergedScores("missing-bundled.json", null, live);
    assert.equal(merged.scores["alpha-two"].source, "live");
  });
});
