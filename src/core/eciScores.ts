import { inflateRawSync } from "node:zlib";
import type { ModelQuote, ScoreEntry } from "./types";

export const EPOCH_BENCHMARK_ZIP_URL = "https://epoch.ai/data/benchmark_data.zip";
export const EPOCH_ECI_PAGE_URL = "https://epoch.ai/eci";
export const ECI_ENTRY_SUFFIX = "eci_scores.csv";

export interface EciRow {
  name: string;
  displayName: string;
  eci: number;
  date: string | null;
}

export interface EciDoc {
  rows: EciRow[];
  fetchedAt: string;
  contentHash: string;
}

export function readZipEntry(zip: Buffer, matches: (name: string) => boolean): Buffer | null {
  try {
    let eocd = -1;
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
      if (zip.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;
    const count = zip.readUInt16LE(eocd + 10);
    let p = zip.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
      if (zip.readUInt32LE(p) !== 0x02014b50) return null;
      const method = zip.readUInt16LE(p + 10);
      const compressedSize = zip.readUInt32LE(p + 20);
      const nameLen = zip.readUInt16LE(p + 28);
      const extraLen = zip.readUInt16LE(p + 30);
      const commentLen = zip.readUInt16LE(p + 32);
      const localOffset = zip.readUInt32LE(p + 42);
      const entryName = zip.toString("utf8", p + 46, p + 46 + nameLen);
      if (matches(entryName)) {
        if (zip.readUInt32LE(localOffset) !== 0x04034b50) return null;
        const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
        const data = zip.subarray(start, start + compressedSize);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return inflateRawSync(data);
        return null;
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export function parseEciCsv(text: string): EciRow[] | null {
  const [header, ...body] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return null;
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const nameCol = col("model");
  const displayCol = col("display name");
  const eciCol = col("eci");
  const dateCol = col("date");
  if (nameCol < 0 || eciCol < 0) return null;
  const rows: EciRow[] = [];
  for (const r of body) {
    const name = (r[nameCol] ?? "").trim();
    const eci = Number(r[eciCol]);
    if (!name || !Number.isFinite(eci)) continue;
    const displayName = displayCol >= 0 && r[displayCol]?.trim() ? r[displayCol].trim() : name;
    const date = dateCol >= 0 && r[dateCol]?.trim() ? r[dateCol].trim() : null;
    rows.push({ name, displayName, eci, date });
  }
  return rows.length > 0 ? rows : null;
}

export function extractEciRows(zip: Buffer): EciRow[] | null {
  const csv = readZipEntry(zip, (n) => n === ECI_ENTRY_SUFFIX || n.endsWith(`/${ECI_ENTRY_SUFFIX}`));
  return csv ? parseEciCsv(csv.toString("utf8")) : null;
}

export function normalizeModelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9.]/g, "")
    .replace(/^\.+|\.+$/g, "");
}

const VARIANT_NEUTRAL_SUFFIX = /^(a\d+(\.\d+)?b|it|instruct)$/;

function uniqueMatch(key: string, rows: Array<{ norm: string; row: EciRow }>): EciRow | null {
  if (!key) return null;
  const exact = rows.filter((r) => r.norm === key);
  if (exact.length === 1) return exact[0].row;
  if (exact.length > 1) return null;
  const loose = rows.filter((r) => r.norm.startsWith(key) && VARIANT_NEUTRAL_SUFFIX.test(r.norm.slice(key.length)));
  return loose.length === 1 ? loose[0].row : null;
}

export interface EciMatch {
  row: EciRow;
  via: "slug" | "name" | "family";
}

export function matchEciRow(quote: Pick<ModelQuote, "slug" | "displayName" | "family">, rows: EciRow[]): EciMatch | null {
  const indexed = rows.flatMap((row) => {
    const keys = new Set([normalizeModelName(row.name), normalizeModelName(row.displayName)]);
    return [...keys].map((norm) => ({ norm, row }));
  });
  const dedupe = (list: typeof indexed) => list.filter((e, i) => list.findIndex((o) => o.norm === e.norm && o.row === e.row) === i);
  const pool = dedupe(indexed);
  const attempts: Array<[EciMatch["via"], string | null | undefined]> = [
    ["slug", quote.slug],
    ["name", quote.displayName],
    ["family", quote.family],
  ];
  for (const [via, raw] of attempts) {
    const hit = raw ? uniqueMatch(normalizeModelName(raw), pool) : null;
    if (hit) return { row: hit, via };
  }
  return null;
}

export function eciScoreTable(quotes: ModelQuote[], doc: EciDoc | null): Record<string, ScoreEntry> {
  const out: Record<string, ScoreEntry> = {};
  if (!doc) return out;
  const asOf = doc.fetchedAt.slice(0, 10);
  for (const q of quotes) {
    const m = matchEciRow(q, doc.rows);
    if (!m) continue;
    out[q.slug] = {
      performanceScore: m.row.eci,
      source: `Epoch AI ECI · ${m.row.displayName}${m.via === "family" ? " (family)" : ""}`,
      asOf,
    };
  }
  return out;
}

export function isEciDoc(x: unknown): x is EciDoc {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return Array.isArray(o.rows) && typeof o.fetchedAt === "string" && typeof o.contentHash === "string";
}
