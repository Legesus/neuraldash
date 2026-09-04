import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MODELS_DEV_API_URL, ModelsDevRegistryProvider } from "../src/providers/modelsDevProvider";

type FetchStub = typeof fetch;

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): FetchStub {
  return ((url: string, init?: RequestInit) => handler(url, init)) as unknown as FetchStub;
}

function jsonResponse(body: unknown, status: number, etag: string | null): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "etag" ? etag : null) },
    json: async () => body,
  } as unknown as Response;
}

describe("modelsDevProvider", () => {
  it("T9 200 returns ok + parsed json + etag", async () => {
    const payload = { neuralwatt: { models: {} } };
    const fetchImpl = stubFetch(async () => jsonResponse(payload, 200, '"abc123"'));
    const p = new ModelsDevRegistryProvider(fetchImpl);
    const res = await p.fetchRegistry(null);
    assert.equal(res.status, "ok");
    if (res.status === "ok") {
      assert.deepEqual(res.json, payload);
      assert.equal(res.etag, '"abc123"');
    }
  });

  it("T10 weak etag sent back verbatim in If-None-Match; 304 -> notModified", async () => {
    let seenIfNoneMatch: string | undefined;
    const fetchImpl = stubFetch(async (_url, init) => {
      seenIfNoneMatch = (init?.headers as Record<string, string>)["If-None-Match"];
      if (seenIfNoneMatch === 'W/"abc"') {
        return { ok: false, status: 304, headers: { get: () => null }, json: async () => null } as unknown as Response;
      }
      return jsonResponse({}, 200, 'W/"abc"');
    });
    const p = new ModelsDevRegistryProvider(fetchImpl);
    const res = await p.fetchRegistry('W/"abc"');
    assert.equal(seenIfNoneMatch, 'W/"abc"');
    assert.equal(res.status, "notModified");
  });

  it("T11 403/429 -> blocked, 500 -> error, rejection -> error, json throw -> error", async () => {
    const blocked403 = new ModelsDevRegistryProvider(stubFetch(async () => jsonResponse(null, 403, null)));
    const r403 = await blocked403.fetchRegistry(null);
    assert.equal(r403.status, "blocked");
    if (r403.status === "blocked") assert.ok(r403.detail.includes("403"));

    const blocked429 = new ModelsDevRegistryProvider(stubFetch(async () => jsonResponse(null, 429, null)));
    const r429 = await blocked429.fetchRegistry(null);
    assert.equal(r429.status, "blocked");

    const err500 = new ModelsDevRegistryProvider(stubFetch(async () => jsonResponse(null, 500, null)));
    const r500 = await err500.fetchRegistry(null);
    assert.equal(r500.status, "error");
    if (r500.status === "error") assert.ok(r500.detail.length > 0);

    const rejects = new ModelsDevRegistryProvider(stubFetch(async () => { throw new Error("boom"); }));
    const rrej = await rejects.fetchRegistry(null);
    assert.equal(rrej.status, "error");
    if (rrej.status === "error") assert.ok(rrej.detail.length > 0);

    const badJson = new ModelsDevRegistryProvider(
      stubFetch(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new Error("bad json"); } }) as unknown as Response),
    );
    const rbad = await badJson.fetchRegistry(null);
    assert.equal(rbad.status, "error");
    if (rbad.status === "error") assert.ok(rbad.detail.length > 0);
  });

  it("sends UA + Accept headers and targets models.dev api.json", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = stubFetch(async (url, init) => {
      seenUrl = url;
      seenHeaders = init?.headers as Record<string, string>;
      return jsonResponse({}, 200, null);
    });
    const p = new ModelsDevRegistryProvider(fetchImpl);
    assert.equal(p.sourceUrl, MODELS_DEV_API_URL);
    await p.fetchRegistry(null);
    assert.equal(seenUrl, MODELS_DEV_API_URL);
    assert.ok(seenHeaders["User-Agent"].startsWith("NeuralDash/"));
    assert.equal(seenHeaders["Accept"], "application/json");
    assert.ok(!("If-None-Match" in seenHeaders));
  });
});
