/**
 * Neuralwatt document provider (anonymous): the GET /v1/models JSON API, the
 * portal energy-pricing PERFORMANCE view HTML and the portal /models CATALOG
 * page HTML.
 * Mirrors modelsDevProvider etiquette (UA header, 30s AbortController
 * timeout, 403/429 -> blocked). Change detection is a SHA-256 content hash:
 * all endpoints send NO usable validators (If-None-Match is ignored, HEAD is
 * 405), so the caller persists the hash of the exact bytes and passes it back;
 * an equal hash short-circuits to "notModified" (content unchanged) before
 * any parsing. Validation via parseNeuralwattModels / parseFlexPerfView /
 * parseFlexCatalogCards happens in the controller (same split as
 * fetchRegistry/transform*).
 */
import { createHash } from "node:crypto";

export const NEURALWATT_MODELS_URL = "https://api.neuralwatt.com/v1/models";
export const NEURALWATT_PERF_URL = "https://portal.neuralwatt.com/energy-pricing?view=performance";
export const NEURALWATT_MODELS_PAGE_URL = "https://portal.neuralwatt.com/models";

const NEURALWATT_MODELS_UA = "NeuralDash/0.3.0 (+VSCode)";
const FETCH_TIMEOUT_MS = 30_000;

export type NeuralwattModelsResult =
  | { status: "ok"; json: unknown; contentHash: string }
  | { status: "notModified" }
  | { status: "blocked"; detail: string }
  | { status: "error"; detail: string };

export type NeuralwattPerfResult =
  | { status: "ok"; html: string; contentHash: string }
  | { status: "notModified" }
  | { status: "blocked"; detail: string }
  | { status: "error"; detail: string };

/** The /models page returns the same HTML-doc union as the perf view (alias prevents drift). */
export type NeuralwattCardsResult = NeuralwattPerfResult;

type TextResult =
  | { status: "ok"; text: string; contentHash: string }
  | { status: "notModified" }
  | { status: "blocked"; detail: string }
  | { status: "error"; detail: string };

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export class NeuralwattModelsProvider {
  readonly sourceUrl = NEURALWATT_MODELS_URL;
  readonly perfUrl = NEURALWATT_PERF_URL;
  readonly modelsPageUrl = NEURALWATT_MODELS_PAGE_URL;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /** Shared fetch path: etiquette + content-hash comparison, no parsing. */
  private async fetchText(url: string, accept: string, contentHash?: string | null): Promise<TextResult> {
    const headers: Record<string, string> = {
      "User-Agent": NEURALWATT_MODELS_UA,
      Accept: accept,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await this.fetchImpl(url, { headers, signal: controller.signal });

      if (res.status === 403 || res.status === 429) {
        return { status: "blocked", detail: `HTTP ${res.status}` };
      }

      if (!res.ok) {
        return { status: "error", detail: `HTTP ${res.status}` };
      }

      let text: string;
      try {
        text = await res.text();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: "error", detail: `ParseError: ${msg}` };
      }

      const hash = sha256Hex(text);
      if (contentHash && hash === contentHash) return { status: "notModified" };
      return { status: "ok", text, contentHash: hash };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("abort")) return { status: "error", detail: "Timeout after 30s" };
      return { status: "error", detail: msg };
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchModels(contentHash?: string | null): Promise<NeuralwattModelsResult> {
    const res = await this.fetchText(this.sourceUrl, "application/json", contentHash);
    if (res.status !== "ok") return res;
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      return { status: "error", detail: "ParseError: invalid JSON body" };
    }
    return { status: "ok", json, contentHash: res.contentHash };
  }

  async fetchPerformanceView(contentHash?: string | null): Promise<NeuralwattPerfResult> {
    const res = await this.fetchText(this.perfUrl, "text/html", contentHash);
    if (res.status !== "ok") return res;
    return { status: "ok", html: res.text, contentHash: res.contentHash };
  }

  /** Portal /models catalog page: byte-for-byte clone of the perf-view fetch etiquette. */
  async fetchModelsCards(contentHash?: string | null): Promise<NeuralwattCardsResult> {
    const res = await this.fetchText(this.modelsPageUrl, "text/html", contentHash);
    if (res.status !== "ok") return res;
    return { status: "ok", html: res.text, contentHash: res.contentHash };
  }
}
