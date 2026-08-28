/**
 * Severity color scale — vscode-free.
 * Cheap=green, expensive=red, saturation scales with distance from median.
 */

export interface SeverityScale {
  /** ln(min basis) */
  lnMin: number;
  /** ln(max basis) */
  lnMax: number;
  /** count of usable (finite, >0) bases */
  count: number;
}

/**
 * Build a scale from raw basis values (basisMwh). Ignores null/<=0/non-finite.
 */
export function computeSeverityScale(bases: Array<number | null>): SeverityScale {
  const valid: number[] = [];
  for (const b of bases) {
    if (b == null || !Number.isFinite(b) || b <= 0) continue;
    valid.push(b);
  }
  if (valid.length === 0) {
    return { lnMin: 0, lnMax: 0, count: 0 };
  }
  const lnVals = valid.map((v) => Math.log(v));
  const lnMin = Math.min(...lnVals);
  const lnMax = Math.max(...lnVals);
  return { lnMin, lnMax, count: valid.length };
}

/**
 * Severity in [0,1] for a single basis. Degenerate scale (count<2 or zero range) -> 0.5.
 * null/<=0/non-finite -> treated externally (grey); this function clamps.
 */
export function severityOf(basis: number | null, scale: SeverityScale): number {
  if (basis == null || !Number.isFinite(basis) || basis <= 0) return 0.5;
  if (scale.count < 2) return 0.5;
  const range = scale.lnMax - scale.lnMin;
  if (range === 0) return 0.5;
  const t = (Math.log(basis) - scale.lnMin) / range;
  return Math.max(0, Math.min(1, t));
}

/**
 * Map severity -> hsl hue: piecewise linear 130 (green) -> 60 (yellow) at s=0.5 -> 0 (red).
 * Saturation 45 + 40*|2s-1| (45% at mid, 85% at extremes), lightness 55%.
 * Returns exact hsl string "hsl(h, s%, 55%)" with integers for h/s.
 */
export function severityColor(s: number): string {
  const clamped = Math.max(0, Math.min(1, s));
  let h: number;
  if (clamped <= 0.5) {
    // 130 -> 60 over [0, 0.5] : h = 130 - 70 * (s/0.5) ??? Actually linear: 130 - (130-60)*(s/0.5) = 130 - 140*s
    // But spec says 130 at s=0, 60 at s=0.5
    h = 130 - 140 * clamped; // at 0 ->130, at 0.5 ->60
  } else {
    // 60 -> 0 over [0.5, 1]
    h = 60 - 120 * (clamped - 0.5); // at 0.5 ->60, at 1 ->0
  }
  // Rounding: use Math.round to get integers
  const hInt = Math.round(h);
  const sat = 45 + 40 * Math.abs(2 * clamped - 1);
  const sInt = Math.round(sat);
  return `hsl(${hInt}, ${sInt}%, 55%)`;
}

/**
 * Basis -> raw 16x16 zap SVG markup string with fill=color.
 * null/invalid basis -> grey #808080.
 */
export function basisToSvgUri(basis: number | null, scale: SeverityScale): string {
  let color: string;
  if (basis == null || !Number.isFinite(basis) || basis <= 0) {
    color = "#808080";
  } else {
    const s = severityOf(basis, scale);
    color = severityColor(s);
  }
  // 16x16 bolt path matching the extension's zap icon
  // viewBox 0 0 16 16, path: M9.5 1 L3.5 9.2h3.4L6 15l6.5-8.2H9.1L9.5 1z
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="${color}" d="M9.5 1 3.5 9.2h3.4L6 15l6.5-8.2H9.1L9.5 1z"/></svg>`;
}
