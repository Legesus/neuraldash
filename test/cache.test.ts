import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CacheManager, createVsCodeStorage, emptyCache, CACHE_VERSION } from "../src/core/cache";
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

describe("cache.createVsCodeStorage fileName", () => {
  const fsImpl = {
    readFile: (p: string, enc: string) => fs.promises.readFile(p, enc as BufferEncoding) as Promise<string>,
    writeFile: (p: string, data: string) => fs.promises.writeFile(p, data, "utf8") as Promise<void>,
    mkdir: (p: string, opts: { recursive: boolean }) => fs.promises.mkdir(p, opts) as Promise<void>,
  };

  it("T17 custom fileName isolates artifacts (registry-cache.json)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nd-cache-"));
    try {
      const storage = createVsCodeStorage(dir, fsImpl, "registry-cache.json");
      await storage.write({ ...emptyCache(), etag: "reg-etag" });
      assert.ok(fs.existsSync(path.join(dir, "registry-cache.json")));
      assert.ok(!fs.existsSync(path.join(dir, "cache.json")));
      const back = await storage.read();
      assert.equal(back?.etag, "reg-etag");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T18 default (no third arg) still targets cache.json", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nd-cache-"));
    try {
      const storage = createVsCodeStorage(dir, fsImpl);
      await storage.write({ ...emptyCache(), etag: "board-etag" });
      assert.ok(fs.existsSync(path.join(dir, "cache.json")));
      const back = await storage.read();
      assert.equal(back?.etag, "board-etag");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
