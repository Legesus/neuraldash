import type { DataProvider, ProviderResult } from "../core/types";
import { parseSnapshot } from "../core/parse";

export const NEURALWATT_URL = "https://portal.neuralwatt.com/energy-pricing";
const UA = "NeuralDash/0.1.0 (+VSCode)";

export class NeuralwattProvider implements DataProvider {
  id = "neuralwatt";
  sourceUrl = NEURALWATT_URL;

  async fetchSnapshot(etag?: string | null): Promise<ProviderResult> {
    const headers: Record<string, string> = {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
    };
    if (etag) headers["If-None-Match"] = etag;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(this.sourceUrl, {
        headers,
        signal: controller.signal,
      });

      if (res.status === 304) {
        return { status: "ok", snapshot: null, notModified: true };
      }

      // Cloudflare / WAF block signals
      if (res.status === 403 || res.status === 429) {
        return { status: "blocked", snapshot: null, detail: `HTTP ${res.status}` };
      }

      if (!res.ok) {
        return { status: "error", snapshot: null, detail: `HTTP ${res.status}` };
      }

      const html = await res.text();
      const etagOut = res.headers.get("etag");
      let snapshot;
      try {
        snapshot = parseSnapshot(html, this.sourceUrl);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: "error", snapshot: null, detail: `ParseError: ${msg}` };
      }

      return {
        status: "ok",
        snapshot,
        etag: etagOut,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("abort")) return { status: "error", snapshot: null, detail: "Timeout after 30s" };
      return { status: "error", snapshot: null, detail: msg };
    } finally {
      clearTimeout(timeout);
    }
  }
}
