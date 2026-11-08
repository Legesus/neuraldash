import type { NeuralwattModelsDoc } from "./flexCatalog";
import { isRecord } from "./flexCatalog";
import { escapeMarkdownLocal } from "./rowView";

export interface SameWeightsThinking {
  readonly mandatory: boolean;
  readonly defaultEnabled: boolean;
  readonly defaultEffort: string | null;
  readonly efforts: readonly string[];
}

export interface ThinkingInfo {
  readonly supported: boolean;
  readonly mandatory: boolean;
  readonly defaultEnabled: boolean;
  readonly defaultEffort: string | null;
  readonly efforts: readonly string[];
  readonly sameWeights?: SameWeightsThinking | null;
}

function entryMetadata(entry: unknown): Record<string, unknown> | null {
  const md = (entry as { metadata?: unknown }).metadata;
  return isRecord(md) ? md : null;
}

function entryReasoning(entry: unknown): Record<string, unknown> | null {
  const r = entryMetadata(entry)?.["reasoning"];
  return isRecord(r) ? r : null;
}

function entryHuggingId(entry: unknown): string | null {
  const h = entryMetadata(entry)?.["huggingface_id"];
  return typeof h === "string" && h !== "" ? h : null;
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

function baseInfo(entry: unknown): { id: string; info: ThinkingInfo } | null {
  if (!isRecord(entry)) return null;
  const id = entry["id"];
  if (typeof id !== "string" || id === "") return null;
  const reasoning = entryReasoning(entry);
  const cap = capabilitiesReasoning(entry);
  if (!reasoning && cap == null) return null;
  const efforts = reasoning ? publishedEfforts(reasoning) : [];
  return {
    id,
    info: {
      supported: cap != null ? cap : efforts.length > 0,
      mandatory: reasoning != null && reasoning["mandatory"] === true,
      defaultEnabled: reasoning != null && reasoning["default_enabled"] === true,
      defaultEffort: reasoning ? publishedDefaultEffort(reasoning) : null,
      efforts,
    },
  };
}

function agrees(a: ThinkingInfo, b: ThinkingInfo): boolean {
  return (
    a.mandatory === b.mandatory &&
    a.defaultEnabled === b.defaultEnabled &&
    a.defaultEffort === b.defaultEffort &&
    a.efforts.length === b.efforts.length &&
    a.efforts.every((e, i) => e === b.efforts[i])
  );
}

function sameWeightsNote(group: readonly ThinkingInfo[]): SameWeightsThinking | null {
  const supported = group.filter((i) => i.supported);
  if (supported.length === 0) return null;
  const first = supported[0];
  for (const s of supported) {
    if (!agrees(first, s)) return null;
  }
  return {
    mandatory: first.mandatory,
    defaultEnabled: first.defaultEnabled,
    defaultEffort: first.defaultEffort,
    efforts: [...first.efforts],
  };
}

export function buildThinkingMap(doc: NeuralwattModelsDoc | null): ReadonlyMap<string, ThinkingInfo> {
  const out = new Map<string, ThinkingInfo>();
  const data = (doc as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return out;
  const idsByHuggingId = new Map<string, string[]>();
  for (const entry of data) {
    const parsed = baseInfo(entry);
    if (!parsed) continue;
    out.set(parsed.id, parsed.info);
    const hf = entryHuggingId(entry);
    if (hf != null) {
      const ids = idsByHuggingId.get(hf);
      if (ids) ids.push(parsed.id);
      else idsByHuggingId.set(hf, [parsed.id]);
    }
  }
  for (const ids of idsByHuggingId.values()) {
    const note = sameWeightsNote(ids.map((id) => out.get(id)!));
    if (!note) continue;
    for (const id of ids) {
      const info = out.get(id)!;
      if (!info.supported && info.sameWeights == null) {
        out.set(id, { ...info, sameWeights: note });
      }
    }
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

function catalogValue(value: string): string {
  return escapeMarkdownLocal(value).replace(/\*/g, "\\*").replace(/_/g, "\\_");
}

function stateWording(info: Pick<ThinkingInfo, "mandatory" | "defaultEnabled" | "defaultEffort">): string {
  const state = info.mandatory ? "always on" : info.defaultEnabled ? "on by default" : "off by default";
  const effort = state === "off by default" ? null : info.defaultEffort;
  return effort != null ? `${state} (${catalogValue(effort)})` : state;
}

export function formatThinkingLine(info: ThinkingInfo): string {
  if (!info.supported) {
    const note = info.sameWeights ? ` \u00b7 same weights: ${stateWording(info.sameWeights)}` : "";
    return `**Thinking** \u00b7 not available${note} \u00b7 /v1/models`;
  }
  const parts = [`**Thinking** \u00b7 ${stateWording(info)}`];
  if (info.efforts.length > 0) parts.push(`levels: ${info.efforts.map((e) => catalogValue(e)).join(", ")}`);
  parts.push("/v1/models");
  return parts.join(" \u00b7 ");
}