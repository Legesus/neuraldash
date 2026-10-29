import { createHash } from "node:crypto";
import { EPOCH_BENCHMARK_ZIP_URL, extractEciRows } from "../core/eciScores";
import type { EciDoc } from "../core/eciScores";

const EPOCH_UA = "NeuralDash/0.3.0 (+VSCode)";
const FETCH_TIMEOUT_MS = 60_000;

export type EpochEciResult =
  | { status: "ok"; doc: EciDoc }
  | { status: "notModified" }
  | { status: "error"; detail: string };

export async function fetchEpochEci(previousHash: string | null, fetchImpl: typeof fetch = fetch): Promise<EpochEciResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(EPOCH_BENCHMARK_ZIP_URL, { headers: { "User-Agent": EPOCH_UA }, signal: controller.signal });
    if (!res.ok) return { status: "error", detail: `HTTP ${res.status}` };
    const zip = Buffer.from(await res.arrayBuffer());
    const contentHash = createHash("sha256").update(zip).digest("hex");
    if (previousHash && previousHash === contentHash) return { status: "notModified" };
    const rows = extractEciRows(zip);
    if (!rows) return { status: "error", detail: "eci_scores.csv missing or unreadable" };
    return { status: "ok", doc: { rows, fetchedAt: new Date().toISOString(), contentHash } };
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timeout);
  }
}
