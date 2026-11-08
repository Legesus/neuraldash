import type { NeuralwattModelsDoc } from "./flexCatalog";

export interface ThinkingInfo {
  readonly supported: boolean;
  readonly mandatory: boolean;
  readonly defaultEnabled: boolean;
  readonly defaultEffort: string | null;
  readonly efforts: readonly string[];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function entryMetadata(entry: unknown): Record<string, unknown> | null {
  const md = (entry as { metadata?: unknown }).metadata;
  return isRecord(md) ? md : null;
}

function entryReasoning(entry: unknown): Record<string, unknown> | null {
  const r = entryMetadata(entry)?.["reasoning"];
  return isRecord(r) ? r : null;
}

function publishedEfforts(reasoning: Record<string, unknown>): string[] {
  const raw = reasoning["supported_efforts"];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const e of raw) {
    if (typeof e !== "string" || e === "" || out.includes(e)) continue;
    out.push(e);
  }
  return out;
}

function capabilitiesReasoning(entry: unknown): boolean | null {
  const c = entryMetadata(entry)?.["capabilities"];
  if (!isRecord(c)) return null;
  const r = c["reasoning"];
  return typeof r === "boolean" ? r : null;
}

function publishedDefaultEffort(reasoning: Record<string, unknown>): string | null {
  const e = reasoning["default_effort"];
  return typeof e === "string" && e !== "" ? e : null;
}

export function buildThinkingMap(doc: NeuralwattModelsDoc | null): ReadonlyMap<string, ThinkingInfo> {
  const out = new Map<string, ThinkingInfo>();
  const data = (doc as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return out;
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    const id = entry["id"];
    if (typeof id !== "string" || id === "") continue;
    const reasoning = entryReasoning(entry);
    if (!reasoning) continue;
    const efforts = publishedEfforts(reasoning);
    const cap = capabilitiesReasoning(entry);
    out.set(id, {
      supported: cap != null ? cap : efforts.length > 0,
      mandatory: reasoning["mandatory"] === true,
      defaultEnabled: reasoning["default_enabled"] === true,
      defaultEffort: publishedDefaultEffort(reasoning),
      efforts,
    });
  }
  return out;
}

export function thinkingFor(
  map: ReadonlyMap<string, ThinkingInfo>,
  candidates: readonly (string | null | undefined)[],
): ThinkingInfo | null {
  for (const c of candidates) {
    if (c == null || c === "") continue;
    const hit = map.get(c);
    if (hit != null) return hit;
  }
  return null;
}

export function formatThinkingLine(info: ThinkingInfo): string {
  if (!info.supported) return "**Thinking** · not available · /v1/models";
  const state = info.mandatory ? "always on" : info.defaultEnabled ? "on by default" : "off by default";
  const effort = state === "off by default" ? null : info.defaultEffort;
  const statePart = effort != null ? `${state} (${effort})` : state;
  const parts = [`**Thinking** · ${statePart}`];
  if (info.efforts.length > 0) parts.push(`levels: ${info.efforts.join(", ")}`);
  parts.push("/v1/models");
  return parts.join(" · ");
}
