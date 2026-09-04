import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RegistryCacheManager, emptyRegistryCache, REGISTRY_CACHE_VERSION } from "../src/core/registryCache";
import type { RegistryCacheData } from "../src/core/registryCache";
import type { ModelsRegistry } from "../src/core/flex";

function makeRegistry(): ModelsRegistry {
  return {
    version: 1,
    generatedAt: "2026-09-04T00:00:00.000Z",
    source: "models.dev api.json",
    models: {
      "glm-5.2-flex": {
        id: "glm-5.2-flex", name: "GLM 5.2 Flex", slug: "glm-5.2-flex", provider: "neuralwatt",
        family: "glm", context: 199984,
        cost: { input: 0.9, output: 2.8, cache_read: 0.09 },
        description: null, last_updated: null,
      },
    },
  };
}

function memoryStorage(initial: RegistryCacheData | null = null) {
  let data: RegistryCacheData | null = initial;
  return {
    async read(): Promise<RegistryCacheData | null> { return data; },
    async write(d: RegistryCacheData): Promise<void> { data = d; },
  };
}

describe("registryCache", () => {
  it("T12 roundtrip: saveRegistry -> load returns registry + etag + lastSuccessAt", async () => {
    const mgr = new RegistryCacheManager(memoryStorage());
    const reg = makeRegistry();
    await mgr.saveRegistry(reg, '"etag-1"');
    const loaded = await mgr.load();
    assert.deepEqual(loaded.registry, reg);
    assert.equal(loaded.etag, '"etag-1"');
    assert.ok(loaded.lastSuccessAt);
    assert.ok(loaded.lastCheckedAt);
    assert.equal(loaded.version, REGISTRY_CACHE_VERSION);
  });

  it("T13 saveNotModified preserves etag + registry, bumps lastCheckedAt only", async () => {
    const mgr = new RegistryCacheManager(memoryStorage());
    const reg = makeRegistry();
    const saved = await mgr.saveRegistry(reg, 'W/"weak-1"');
    const before = saved.lastCheckedAt;
    await new Promise((r) => setTimeout(r, 5));
    const after = await mgr.saveNotModified();
    assert.equal(after.etag, 'W/"weak-1"');
    assert.deepEqual(after.registry, reg);
    assert.equal(after.lastSuccessAt, saved.lastSuccessAt);
    assert.ok(after.lastCheckedAt);
    assert.notEqual(after.lastCheckedAt, before);
  });

  it("T14 version guard: wrong version -> emptyRegistryCache", async () => {
    const stale: RegistryCacheData = {
      version: 999,
      registry: makeRegistry(),
      etag: '"x"',
      lastSuccessAt: "2026-01-01T00:00:00.000Z",
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
    };
    const mgr = new RegistryCacheManager(memoryStorage(stale));
    assert.deepEqual(await mgr.load(), emptyRegistryCache());
  });

  it("T15 read-failure -> emptyRegistryCache, no throw", async () => {
    const bad = {
      async read(): Promise<RegistryCacheData | null> { throw new Error("read fail"); },
      async write(): Promise<void> {},
    };
    const mgr = new RegistryCacheManager(bad);
    assert.deepEqual(await mgr.load(), emptyRegistryCache());
  });

  it("T16 load on empty storage -> emptyRegistryCache", async () => {
    const mgr = new RegistryCacheManager(memoryStorage(null));
    assert.deepEqual(await mgr.load(), emptyRegistryCache());
  });
});
