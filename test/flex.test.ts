import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { formatContextTokens, loadModelsRegistry } from "../src/core/flex";

describe("flex.formatters", () => {
  it("formatContextTokens cases", () => {
    assert.equal(formatContextTokens(262128), "262k");
    assert.equal(formatContextTokens(1048560), "1.0M");
    assert.equal(formatContextTokens(null), "-");
    assert.equal(formatContextTokens(500), "500");
    assert.equal(formatContextTokens(1000), "1k");
  });
});

describe("flex.loader", () => {
  it("missing file -> null", () => {
    assert.equal(loadModelsRegistry("/no/such/path.json"), null);
  });
  it("corrupt json -> null", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flex-"));
    const p = path.join(dir, "bad.json");
    fs.writeFileSync(p, "{ not json");
    assert.equal(loadModelsRegistry(p), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("valid registry file -> parsed models", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flex-"));
    const p = path.join(dir, "ok.json");
    fs.writeFileSync(
      p,
      JSON.stringify({
        version: 1,
        generatedAt: "2026-09-17T00:00:00.000Z",
        source: "test",
        models: {
          "glm-5.3-flex": {
            id: "glm-5.3-flex", name: "GLM 5.3 (flex)", slug: "glm-5.3-flex", provider: "neuralwatt",
            family: "glm", context: 1048560,
            cost: { input: 0.9425, output: 2.925, cache_read: 0.09425 },
            description: null, last_updated: null,
          },
          "junk-entry": { not: "a model" },
        },
      }),
    );
    const reg = loadModelsRegistry(p);
    assert.ok(reg);
    assert.equal(Object.keys(reg!.models).length, 1);
    assert.equal(reg!.models["glm-5.3-flex"]!.cost.input, 0.9425);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
