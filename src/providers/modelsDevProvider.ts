/**
 * models.dev registry fetch provider. Mirrors neuralwattProvider etiquette
 * (UA header, 30s AbortController timeout, verbatim If-None-Match, 403/429
 * -> blocked) but returns the parsed api.json body rather than a Snapshot.
 */

export const MODELS_DEV_API_URL = "https://models.dev/api.json";

const MODELS_DEV_UA = "NeuralDash/0.3.0 (+VSCode)";
const FETCH_TIMEOUT_MS = 30_000;

export type RegistryFetchResult =
  | { status: "ok"; json: unknown; etag: string | null }
  | { status: "notModified" }
  | { status: "blocked"; detail: string }
  | { status: "error"; detail: string };

export interface RegistryDataProvider {
  readonly id: string;
  readonly sourceUrl: string;
  fetchRegistry(etag?: string | null): Promise<RegistryFetchResult>;
}

export class ModelsDevRegistryProvider implements RegistryDataProvider {
  readonly id = "modelsdev";
  readonly sourceUrl = MODELS_DEV_API_URL;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchRegistry(etag?: string | null): Promise<RegistryFetchResult> {
    const headers: Record<string, string> = {
      "User-Agent": MODELS_DEV_UA,
      Accept: "application/json",
    };
    // ETag must round-trip VERBATIM (server keys etag by content-encoding;
    // Node's auto-gzip yields the weak W/"..." variant).
    if (etag) headers["If-None-Match"] = etag;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await this.fetchImpl(this.sourceUrl, {
        headers,
        signal: controller.signal,
      });

      if (res.status === 304) {
        return { status: "notModified" };
      }

      if (res.status === 403 || res.status === 429) {
        return { status: "blocked", detail: `HTTP ${res.status}` };
      }

      if (!res.ok) {
        return { status: "error", detail: `HTTP ${res.status}` };
      }

      const etagOut = res.headers.get("etag");
      let json: unknown;
      try {
        json = await res.json();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: "error", detail: `ParseError: ${msg}` };
      }

      return { status: "ok", json, etag: etagOut };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("abort")) return { status: "error", detail: "Timeout after 30s" };
      return { status: "error", detail: msg };
    } finally {
      clearTimeout(timeout);
    }
  }
}
