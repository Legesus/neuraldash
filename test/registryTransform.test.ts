import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { transformModelsDevRegistry } from "../src/core/registryTransform";

const fixturePath = path.resolve(__dirname, "../../test/fixtures/models-dev-sample.json");
const GENERATED_AT = "2026-09-04T00:00:00.000Z";

function fixture(): unknown {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as unknown;
}

describe("registryTransform", () => {
  it("T1 happy path: version/source/generatedAt passthrough", () => {
    const reg = transformModelsDevRegistry(fixture(), GENERATED_AT);
    assert.ok(reg);
    assert.equal(reg.version, 1);
    assert.equal(reg.source, "models.dev api.json");
    assert.equal(reg.generatedAt, GENERATED_AT);
  });

  it("T2 qwen regression: exactly ONE qwen key, modelId-derived", () => {
    const reg = transformModelsDevRegistry(fixture(), GENERATED_AT);
    assert.ok(reg);
    const keys = Object.keys(reg.models).filter((k) => k.includes("qwen"));
    assert.deepEqual(keys, ["qwen-3.8-27b"]);
    assert.equal(reg.models["qwen-3.8-27b"].name, "Qwen3.8 27B");
  });

  it("T3 flex entries preserved with exact cost mapping", () => {
    const reg = transformModelsDevRegistry(fixture(), GENERATED_AT);
    assert.ok(reg);
    const a = reg.models["glm-5.2-flex"];
    assert.ok(a);
    assert.deepEqual(a.cost, { input: 0.9, output: 2.8, cache_read: 0.09 });
    assert.equal(a.slug, "glm-5.2-flex");
    assert.equal(a.provider, "neuralwatt");
    const b = reg.models["glm-5.2-short-fast-flex"];
    assert.ok(b);
    assert.deepEqual(b.cost, { input: 0.9425, output: 2.925, cache_read: 0.09425 });
  });

  it("T4 costless entries skipped (missing cost / non-numeric)", () => {
    const reg = transformModelsDevRegistry(fixture(), GENERATED_AT);
    assert.ok(reg);
    assert.ok(!("kimi-k2.7-code" in reg.models));
    assert.ok(!("deepseek-v4-flash" in reg.models));
  });

  it("T5 other providers ignored", () => {
    const reg = transformModelsDevRegistry(fixture(), GENERATED_AT);
    assert.ok(reg);
    assert.ok(!("decoy-flex" in reg.models));
  });

  it("T6 unknown-field tolerance: status beta entry survives", () => {
    const reg = transformModelsDevRegistry(fixture(), GENERATED_AT);
    assert.ok(reg);
    const m = reg.models["glm-5.3"];
    assert.ok(m);
    assert.equal(m.name, "GLM 5.3");
    assert.equal(m.context, 1048560);
  });

  it("T7 null-safety: garbage in -> null, no throw", () => {
    assert.equal(transformModelsDevRegistry(null), null);
    assert.equal(transformModelsDevRegistry(undefined), null);
    assert.equal(transformModelsDevRegistry({}), null);
    assert.equal(transformModelsDevRegistry({ neuralwatt: null }), null);
    assert.equal(transformModelsDevRegistry({ neuralwatt: { models: "x" } }), null);
    assert.equal(transformModelsDevRegistry({ neuralwatt: { models: null } }), null);
    assert.equal(transformModelsDevRegistry([]), null);
    assert.equal(transformModelsDevRegistry("nope"), null);
  });

  it("T8 slugify(modelId) keying preserves dots/dashes", () => {
    const reg = transformModelsDevRegistry(fixture(), GENERATED_AT);
    assert.ok(reg);
    assert.ok("glm-5.2-short-fast-flex" in reg.models);
    assert.ok("glm-5.3" in reg.models);
  });
});
