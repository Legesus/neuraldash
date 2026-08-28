import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CacheManager, emptyCache, CACHE_VERSION } from "../src/core/cache";
import type { CacheData, Snapshot } from "../src/core/types";

function makeSnapshot(): Snapshot {
  return {
    quotes: [],
    fetchedAt: new Date().toISOString(),
    sourceUrl: "https://example.com",
  };
}

function memoryStorage(initial: CacheData | null = null): { read(): Promise<CacheData | null>; write(d: CacheData): Promise<void>; _data: CacheData | null } {
  let data: CacheData | null = initial;
  return {
    async read() { return data; },
    async write(d: CacheData) { data = d; },
    get _data() { return data; },
  };
}

describe("cache", () => {
  it("roundtrip with in-memory fake storage", async () => {
    const storage = memoryStorage();
    const mgr = new CacheManager(storage);
    const snap = makeSnapshot();
    await mgr.saveSnapshot(snap, "etag-123");
    const loaded = await mgr.load();
    assert.equal(loaded.etag, "etag-123");
    assert.equal(loaded.snapshot?.sourceUrl, snap.sourceUrl);
    assert.equal(loaded.version, CACHE_VERSION);
    assert.ok(loaded.lastSuccessAt);
    assert.ok(loaded.lastCheckedAt);
  });

  it("preserves etag on saveSnapshot and saveNotModified", async () => {
    const storage = memoryStorage();
    const mgr = new CacheManager(storage);
    const snap = makeSnapshot();
    await mgr.saveSnapshot(snap, "etag-abc");
    await mgr.saveNotModified();
    const loaded = await mgr.load();
    assert.equal(loaded.etag, "etag-abc");
  });

  it("empty load returns emptyCache when nothing stored", async () => {
    const storage = memoryStorage(null);
    const mgr = new CacheManager(storage);
    const loaded = await mgr.load();
    assert.deepEqual(loaded, emptyCache());
  });

  it("read failure yields empty cache, no throw", async () => {
    const bad = {
      async read() { throw new Error("read fail"); },
      async write() {},
    };
    const mgr = new CacheManager(bad);
    const loaded = await mgr.load();
    assert.deepEqual(loaded, emptyCache());
  });
});
