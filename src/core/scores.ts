import * as fs from "fs";
import * as path from "path";
import type { ScoreTable, ScoreEntry } from "./types";

const DEFAULT_TABLE: ScoreTable = { version: 1, scores: {} };

function isValidScoreEntry(v: unknown): v is ScoreEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.performanceScore !== "number" || !Number.isFinite(o.performanceScore)) return false;
  if (typeof o.source !== "string" || !o.source) return false;
  if (typeof o.asOf !== "string" || !o.asOf) return false;
  return true;
}

function isScoreTable(x: unknown): x is ScoreTable {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.version !== "number") return false;
  if (!o.scores || typeof o.scores !== "object") return false;
  return true;
}

function sanitizeScores(raw: Record<string, unknown>): Record<string, ScoreEntry> {
  const out: Record<string, ScoreEntry> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (isValidScoreEntry(v)) out[k] = v;
  }
  return out;
}

export function loadBundledScores(bundledPath: string): ScoreTable {
  try {
    const raw = fs.readFileSync(bundledPath, "utf8");
    const parsed = JSON.parse(raw);
    if (isScoreTable(parsed)) {
      return {
        version: parsed.version,
        scores: sanitizeScores(parsed.scores as Record<string, unknown>),
      };
    }
    return DEFAULT_TABLE;
  } catch {
    return DEFAULT_TABLE;
  }
}

export function loadOverrideScores(overridePath: string | null | undefined): ScoreTable | null {
  if (!overridePath) return null;
  try {
    const p = overridePath.trim();
    if (!p) return null;
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (isScoreTable(parsed)) {
      return {
        version: parsed.version,
        scores: sanitizeScores(parsed.scores as Record<string, unknown>),
      };
    }
    // Also accept plain record form {slug: ScoreEntry}
    if (parsed && typeof parsed === "object" && !("version" in (parsed as Record<string, unknown>))) {
      const map = parsed as Record<string, unknown>;
      // only accept if at least one entry is valid; sanitize all
      const sanitized = sanitizeScores(map);
      if (Object.keys(sanitized).length > 0) {
        return { version: 1, scores: sanitized };
      }
      // If the map was non-empty but had no valid entries, treat as no valid override
      if (Object.keys(map).length > 0) return null;
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

export function mergedScores(bundledPath: string, overridePath: string | null | undefined): ScoreTable {
  const bundled = loadBundledScores(bundledPath);
  const override = loadOverrideScores(overridePath);
  if (!override) return bundled;
  // user-wins per slug
  return {
    version: override.version ?? bundled.version,
    scores: { ...bundled.scores, ...override.scores },
  };
}

export function resolveBundledScoresPath(extensionRoot: string): string {
  return path.join(extensionRoot, "data", "scores.json");
}
