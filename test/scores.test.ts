import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadBundledScores, loadOverrideScores, mergedScores } from "../src/core/scores";

describe("scores", () => {
  it("loads bundled scores (may be empty)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nd-scores-"));
    try {
      const bundledPath = path.join(tmpDir, "scores.json");
      fs.writeFileSync(bundledPath, JSON.stringify({ version: 1, scores: { a: { performanceScore: 80, source: "https://x", asOf: "2026-01-01" } } }));
      const t = loadBundledScores(bundledPath);
      assert.equal(t.version, 1);
      assert.ok(t.scores["a"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("missing/malformed bundled → empty default, no throw", () => {
    const t = loadBundledScores("/no/such/path.json");
    assert.equal(t.version, 1);
    assert.deepEqual(t.scores, {});
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nd-scores-"));
    try {
      const p = path.join(tmpDir, "bad.json");
      fs.writeFileSync(p, "{ not json");
      const t2 = loadBundledScores(p);
      assert.equal(t2.version, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("override merge is user-wins per slug", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nd-scores-"));
    try {
      const bundledPath = path.join(tmpDir, "bundled.json");
      const overridePath = path.join(tmpDir, "override.json");
      fs.writeFileSync(bundledPath, JSON.stringify({ version: 1, scores: { a: { performanceScore: 80, source: "bundled", asOf: "2026-01-01" }, b: { performanceScore: 70, source: "bundled", asOf: "2026-01-01" } } }));
      fs.writeFileSync(overridePath, JSON.stringify({ version: 1, scores: { a: { performanceScore: 90, source: "override", asOf: "2026-02-01" } } }));
      const merged = mergedScores(bundledPath, overridePath);
      assert.equal(merged.scores["a"].performanceScore, 90);
      assert.equal(merged.scores["a"].source, "override");
      assert.equal(merged.scores["b"].performanceScore, 70);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("missing/malformed override → bundled, no throw", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nd-scores-"));
    try {
      const bundledPath = path.join(tmpDir, "bundled.json");
      fs.writeFileSync(bundledPath, JSON.stringify({ version: 1, scores: { a: { performanceScore: 80, source: "s", asOf: "2026-01-01" } } }));
      const merged = mergedScores(bundledPath, "/no/such/override.json");
      assert.equal(merged.scores["a"].performanceScore, 80);
      const badPath = path.join(tmpDir, "bad.json");
      fs.writeFileSync(badPath, "{ not json");
      const merged2 = mergedScores(bundledPath, badPath);
      assert.equal(merged2.scores["a"].performanceScore, 80);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("loadOverrideScores returns null for missing", () => {
    assert.equal(loadOverrideScores(null), null);
    assert.equal(loadOverrideScores(""), null);
    assert.equal(loadOverrideScores("/no/such.json"), null);
  });
});
