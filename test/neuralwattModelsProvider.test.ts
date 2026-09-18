import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  NEURALWATT_MODELS_URL,
  NEURALWATT_PERF_URL,
  NEURALWATT_MODELS_PAGE_URL,
  NeuralwattModelsProvider,
} from "../src/providers/neuralwattModelsProvider";

type FetchStub = typeof fetch;

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): FetchStub {
  return ((url: string, init?: RequestInit) => handler(url, init)) as unknown as FetchStub;
}

function textResponse(body: string, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
  } as unknown as Response;
}

function sha256(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

describe("neuralwattModelsProvider.fetchModels", () => {
  it("F1 200 returns ok + parsed json + sha256 of the exact bytes", async () => {
    const body = JSON.stringify({ object: "list", data: [{ id: "acme-flex" }], scope: "public" });
    const fetchImpl = stubFetch(async () => textResponse(body, 200));
    const p = new NeuralwattModelsProvider(fetchImpl);
    const res = await p.fetchModels(null);
    assert.equal(res.status, "ok");
    if (res.status === "ok") {
      assert.deepEqual(res.json, JSON.parse(body));
      assert.equal(res.contentHash, sha256(body));
    }
  });

  it("F2 hash-equal -> notModified (no If-None-Match machinery exists)", async () => {
    const body = JSON.stringify({ object: "list", data: [] });
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = stubFetch(async (_url, init) => {
      seenHeaders = init?.headers as Record<string, string>;
      return textResponse(body, 200);
    });
    const p = new NeuralwattModelsProvider(fetchImpl);
    const res = await p.fetchModels(sha256(body));
    assert.equal(res.status, "notModified");
    assert.ok(!("If-None-Match" in seenHeaders));
  });

  it("F3 hash-diff -> ok with the NEW hash", async () => {
    const body = JSON.stringify({ object: "list", data: [{ id: "changed" }] });
    const p = new NeuralwattModelsProvider(stubFetch(async () => textResponse(body, 200)));
    const res = await p.fetchModels("stale-hash");
    assert.equal(res.status, "ok");
    if (res.status === "ok") assert.equal(res.contentHash, sha256(body));
  });

  it("F4 403/429 -> blocked, 500 -> error, rejection -> error, bad JSON -> ParseError", async () => {
    const blocked403 = new NeuralwattModelsProvider(stubFetch(async () => textResponse("nope", 403)));
    const r403 = await blocked403.fetchModels(null);
    assert.equal(r403.status, "blocked");
    if (r403.status === "blocked") assert.ok(r403.detail.includes("403"));

    const blocked429 = new NeuralwattModelsProvider(stubFetch(async () => textResponse("nope", 429)));
    assert.equal((await blocked429.fetchModels(null)).status, "blocked");

    const err500 = new NeuralwattModelsProvider(stubFetch(async () => textResponse("boom", 500)));
    const r500 = await err500.fetchModels(null);
    assert.equal(r500.status, "error");

    const rejects = new NeuralwattModelsProvider(stubFetch(async () => { throw new Error("boom"); }));
    const rrej = await rejects.fetchModels(null);
    assert.equal(rrej.status, "error");
    if (rrej.status === "error") assert.ok(rrej.detail.length > 0);

    const badJson = new NeuralwattModelsProvider(stubFetch(async () => textResponse("<html>not json</html>", 200)));
    const rbad = await badJson.fetchModels(null);
    assert.equal(rbad.status, "error");
    if (rbad.status === "error") assert.ok(rbad.detail.startsWith("ParseError:"));

    const badText = new NeuralwattModelsProvider(
      stubFetch(async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => { throw new Error("stream broke"); } }) as unknown as Response),
    );
    const rstream = await badText.fetchModels(null);
    assert.equal(rstream.status, "error");
    if (rstream.status === "error") assert.ok(rstream.detail.startsWith("ParseError:"));
  });

  it("F5 abort -> 'Timeout after 30s'", async () => {
    const aborts = new NeuralwattModelsProvider(stubFetch(async () => { throw new Error("The operation was aborted"); }));
    const res = await aborts.fetchModels(null);
    assert.equal(res.status, "error");
    if (res.status === "error") assert.equal(res.detail, "Timeout after 30s");
  });

  it("F6 sends UA + JSON Accept to api.neuralwatt.com /v1/models", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = stubFetch(async (url, init) => {
      seenUrl = url;
      seenHeaders = init?.headers as Record<string, string>;
      return textResponse("{}", 200);
    });
    const p = new NeuralwattModelsProvider(fetchImpl);
    assert.equal(p.sourceUrl, NEURALWATT_MODELS_URL);
    await p.fetchModels(null);
    assert.equal(seenUrl, NEURALWATT_MODELS_URL);
    assert.ok(seenHeaders["User-Agent"].startsWith("NeuralDash/"));
    assert.equal(seenHeaders["Accept"], "application/json");
  });
});

describe("neuralwattModelsProvider.fetchPerformanceView", () => {
  it("P1 200 returns ok + raw html + sha256; targets the perf view with an HTML Accept", async () => {
    const html = "<html><body><tr data-perf-lane=\"acme\"></tr></body></html>";
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = stubFetch(async (url, init) => {
      seenUrl = url;
      seenHeaders = init?.headers as Record<string, string>;
      return textResponse(html, 200);
    });
    const p = new NeuralwattModelsProvider(fetchImpl);
    assert.equal(p.perfUrl, NEURALWATT_PERF_URL);
    const res = await p.fetchPerformanceView(null);
    assert.equal(res.status, "ok");
    if (res.status === "ok") {
      assert.equal(res.html, html);
      assert.equal(res.contentHash, sha256(html));
    }
    assert.equal(seenUrl, NEURALWATT_PERF_URL);
    assert.equal(seenHeaders["Accept"], "text/html");
    assert.ok(seenHeaders["User-Agent"].startsWith("NeuralDash/"));
  });

  it("P2 hash-equal -> notModified; hash-diff -> ok with the new hash", async () => {
    const html = "<html>perf v1</html>";
    const p = new NeuralwattModelsProvider(stubFetch(async () => textResponse(html, 200)));
    assert.equal((await p.fetchPerformanceView(sha256(html))).status, "notModified");
    const changed = await p.fetchPerformanceView("stale");
    assert.equal(changed.status, "ok");
    if (changed.status === "ok") assert.equal(changed.contentHash, sha256(html));
  });

  it("P3 blocked / error / timeout tails match the models path", async () => {
    const blocked = new NeuralwattModelsProvider(stubFetch(async () => textResponse("nope", 429)));
    assert.equal((await blocked.fetchPerformanceView(null)).status, "blocked");

    const err = new NeuralwattModelsProvider(stubFetch(async () => textResponse("boom", 503)));
    assert.equal((await err.fetchPerformanceView(null)).status, "error");

    const aborts = new NeuralwattModelsProvider(stubFetch(async () => { throw new Error("The operation was aborted"); }));
    const res = await aborts.fetchPerformanceView(null);
    assert.equal(res.status, "error");
    if (res.status === "error") assert.equal(res.detail, "Timeout after 30s");
  });
});

describe("neuralwattModelsProvider.fetchModelsCards", () => {
  it("MC1 200 returns ok + raw html + sha256; targets the /models page with an HTML Accept", async () => {
    const html = "<html><body><article data-family=\"Acme\"></article></body></html>";
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = stubFetch(async (url, init) => {
      seenUrl = url;
      seenHeaders = init?.headers as Record<string, string>;
      return textResponse(html, 200);
    });
    const p = new NeuralwattModelsProvider(fetchImpl);
    assert.equal(p.modelsPageUrl, NEURALWATT_MODELS_PAGE_URL);
    const res = await p.fetchModelsCards(null);
    assert.equal(res.status, "ok");
    if (res.status === "ok") {
      assert.equal(res.html, html);
      assert.equal(res.contentHash, sha256(html));
    }
    assert.equal(seenUrl, NEURALWATT_MODELS_PAGE_URL);
    assert.equal(seenHeaders["Accept"], "text/html");
    assert.ok(seenHeaders["User-Agent"].startsWith("NeuralDash/"));
  });

  it("MC2 hash-equal -> notModified; hash-diff -> ok with the new hash", async () => {
    const html = "<html>models page v1</html>";
    const p = new NeuralwattModelsProvider(stubFetch(async () => textResponse(html, 200)));
    assert.equal((await p.fetchModelsCards(sha256(html))).status, "notModified");
    const changed = await p.fetchModelsCards("stale");
    assert.equal(changed.status, "ok");
    if (changed.status === "ok") assert.equal(changed.contentHash, sha256(html));
  });

  it("MC3 blocked / error / timeout tails match the perf path", async () => {
    const blocked403 = new NeuralwattModelsProvider(stubFetch(async () => textResponse("nope", 403)));
    assert.equal((await blocked403.fetchModelsCards(null)).status, "blocked");

    const blocked429 = new NeuralwattModelsProvider(stubFetch(async () => textResponse("nope", 429)));
    assert.equal((await blocked429.fetchModelsCards(null)).status, "blocked");

    const err = new NeuralwattModelsProvider(stubFetch(async () => textResponse("boom", 500)));
    assert.equal((await err.fetchModelsCards(null)).status, "error");

    const aborts = new NeuralwattModelsProvider(stubFetch(async () => { throw new Error("The operation was aborted"); }));
    const res = await aborts.fetchModelsCards(null);
    assert.equal(res.status, "error");
    if (res.status === "error") assert.equal(res.detail, "Timeout after 30s");
  });
});
