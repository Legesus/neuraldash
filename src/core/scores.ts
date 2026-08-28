import * as fs from "fs";
import * as path from "path";
import type { ScoreTable } from "./types";

const DEFAULT_TABLE: ScoreTable = { version: 1, scores: {} };

function isScoreTable(x: unknown): x is ScoreTable {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.version !== "number") return false;
  if (!o.scores || typeof o.scores !== "object") return false;
  return true;
}

export function loadBundledScores(bundledPath: string): ScoreTable {
  try {
    const raw = fs.readFileSync(bundledPath, "utf8");
    const parsed = JSON.parse(raw);
    if (isScoreTable(parsed)) return parsed;
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
    if (isScoreTable(parsed)) return parsed;
    // Also accept plain record form {slug: ScoreEntry}
    if (parsed && typeof parsed === "object" && !("version" in (parsed as Record<string, unknown>))) {
      // heuristic: if it looks like a score map
      const maybeMap = parsed as Record<string, unknown>;
      const firstVal = Object.values(maybeMap)[0] as Record<string, unknown> | undefined;
      if (firstVal && typeof firstVal.performanceScore === "number") {
        return { version: 1, scores: parsed as ScoreTable["scores"] };
      }
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
