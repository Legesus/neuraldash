import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * BLOCKING invariant for the zero-curated-constants requirement.
 *
 * The flex pipeline is enumerated entirely from fetched documents; its
 * sources must never contain model-identifier literals or numeric multiplier
 * literals. Compiled tests run from out/test, so the repo root is two levels
 * up and the ts sources (not the compiled copies) are scanned. Document
 * surface probes ("service_tier=\"flex\"", "data-perf-lane", URLs) are NOT
 * model identifiers and are intentionally allowed.
 *
 * Pre-existing baked tables elsewhere (e.g. src/core/registry.ts) are OUT OF
 * SCOPE for this invariant.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const FLEX_SOURCES: readonly string[] = [
  "src/core/flexCatalog.ts",
  "src/core/flexPerf.ts",
  "src/core/flexCatalogCards.ts",
  "src/core/flexDiagnostics.ts",
  "src/core/flexCatalogCache.ts",
  "src/core/displayNames.ts",
  "src/providers/neuralwattModelsProvider.ts",
];

const MODEL_LITERAL = /kimi|glm-|qwen|deepseek|gemma/i;

/** Numeric multiplier literals: the known default and digit-adjacent signs. */
const MULTIPLIER_LITERALS: ReadonlyArray<readonly [string, RegExp]> = [
  ["hardcoded 0.65 default", /0\.65/],
  ["multiplier literal before the multiplication sign", /[0-9][0-9.]*\s*\u00d7/],
  ["multiplier literal after the multiplication sign", /\u00d7\s*[0-9]/],
];

function readSource(rel: string): string {
  const abs = path.join(REPO_ROOT, rel);
  assert.ok(fs.existsSync(abs), `flex source missing (renamed?): ${rel}`);
  return fs.readFileSync(abs, "utf8");
}

function offendingLines(text: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const hit = line.match(pattern);
    if (hit) out.push(`${i + 1}: ${line.trim()} (matched "${hit[0]}")`);
  });
  return out;
}

describe("grepInvariant — flex sources carry no curated constants", () => {
  it("G1 no model-identifier literals in any flex pipeline source", () => {
    for (const rel of FLEX_SOURCES) {
      const offenders = offendingLines(readSource(rel), MODEL_LITERAL);
      assert.deepEqual(offenders, [], `${rel} contains model identifier literals:\n${offenders.join("\n")}`);
    }
  });

  it("G2 no numeric multiplier literals in any flex pipeline source", () => {
    for (const rel of FLEX_SOURCES) {
      const text = readSource(rel);
      for (const [label, pattern] of MULTIPLIER_LITERALS) {
        const offenders = offendingLines(text, pattern);
        assert.deepEqual(offenders, [], `${rel} violates "${label}":\n${offenders.join("\n")}`);
      }
    }
  });

  it("G3 self-check: the patterns catch planted literals (the invariant can actually fail)", () => {
    assert.notEqual('export const CURATED = ["kimi-k3-fast"];'.match(MODEL_LITERAL), null);
    assert.notEqual('const FALLBACK = "glm-5.3-flash";'.match(MODEL_LITERAL), null);
    assert.notEqual("const M = 0.65;".match(MULTIPLIER_LITERALS[0]![1]), null);
    assert.notEqual("`${base} \u00b7 0.65\u00d7 derived`".match(MULTIPLIER_LITERALS[1]![1]), null);
    assert.notEqual("`\u00d7 0.65 derived`".match(MULTIPLIER_LITERALS[2]![1]), null);
  });
});
