/**
 * Trimmed INLINE fixtures shared by the flex test suites.
 *
 * Mirrors the structures of the three live documents captured 2026-09-18:
 *   - https://api.neuralwatt.com/v1/models (19 entries, 12 standard + 7 flex)
 *   - https://portal.neuralwatt.com/energy-pricing?view=performance (metrics
 *     table with 11 lane rows + Standard sibling rows; a second "Average
 *     energy per request" table repeating preview chips with no model data
 *     attributes)
 *   - https://portal.neuralwatt.com/models (11 family cards, 8 flex, 14 ids)
 * Volatile fields (energy figures, latencies, metric states, trends) are
 * trimmed. Tests never read the researcher's temp files.
 */

// ---------------------------------------------------------------- perf view

export const FLEX_MARKER =
  `<span class="nw-tag nw-tag-sm nw-tag-blue" title="Wait for spare capacity for an energy discount.">Flex tier</span>` +
  `<span class="font-mono text-[10.5px] text-nw-fg3" data-perf-invocation>service_tier=&#34;flex&#34;</span>`;

export const speedMarker = (slug: string): string =>
  `<span class="nw-tag nw-tag-sm nw-tag-terra" title="The Speed lane trades energy for latency.">Speed lane</span>` +
  `<span class="font-mono text-[10.5px] text-nw-fg3" data-perf-invocation>${slug}</span>`;

export const previewChip = (name: string): string =>
  `<a href="/enroll/request-preview" class="ml-2 align-middle inline-block px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-medium rounded-full hover:underline" title="${name} is in preview \u2014 request access">Preview</a>`;

export interface PerfLaneSpec {
  readonly slug: string;
  readonly family: string;
  readonly flex: boolean;
}

/** The 11 live flex-lane rows in page order (10 flex + 1 speed). */
export const PERF_LANES: readonly PerfLaneSpec[] = [
  { slug: "deepseek-v4-flash", family: "DeepSeek V4 Flash", flex: true },
  { slug: "deepseek-v4-flash-speed", family: "DeepSeek V4 Flash", flex: false },
  { slug: "deepseek-v4.1-flash", family: "DeepSeek V4.1 Flash", flex: true },
  { slug: "glm-5.3", family: "GLM-5.3", flex: true },
  { slug: "glm-5.3-flash", family: "GLM-5.3 Flash", flex: true },
  { slug: "kimi-k2.7-code", family: "Kimi K2.7 Code", flex: true },
  { slug: "kimi-k3", family: "Kimi K3", flex: true },
  { slug: "kimi-k3-fast", family: "Kimi K3", flex: true },
  { slug: "qwen-3.8-27b", family: "Qwen 3.8 27B", flex: true },
  { slug: "qwen3.6-35b", family: "Qwen3.6 35B", flex: true },
  { slug: "qwen3.6-35b-fast", family: "Qwen3.6 35B", flex: true },
];

/** The 3 live preview chips, carried by Standard sibling rows in table 1. */
export const PERF_PREVIEW_STANDARD = [
  { slug: "deepseek-v4-pro", family: "DeepSeek V4 Pro", display: "DeepSeek V4-Pro" },
  { slug: "deepseek-v4.1-flash", family: "DeepSeek V4.1 Flash", display: "DeepSeek V4.1 Flash" },
  { slug: "qwen3-embedding-8b", family: "qwen3-embedding-8b", display: "Qwen3 Embedding 8B" },
] as const;

export function laneRow(slug: string, family: string, marker: string, extra = ""): string {
  return (
    `<tr class="group hover:bg-nw-surface-2 transition-colors" data-perf-lane="${slug}" data-family-row="${family}">` +
    `<td class="px-4 py-3 pl-14">` +
    `<div class="font-medium text-nw-fg1 whitespace-nowrap"><span class="text-nw-fg3 mr-1" aria-hidden="true">&#8627;</span>${slug}</div>` +
    `<div class="mt-0.5 flex flex-wrap items-center gap-1">${marker}${extra}</div>` +
    `</td>` +
    `<td class="px-3 py-3 text-right align-top" data-perf-state="published"><div class="nw-num font-semibold text-nw-fg1 whitespace-nowrap">1.0 s</div></td>` +
    `</tr>`
  );
}

export function standardRow(slug: string, family: string, chip = ""): string {
  return (
    `<tr class="group hover:bg-nw-surface-2 transition-colors" data-family-row="${family}">` +
    `<td class="px-4 py-3 pl-9">` +
    `<div class="font-medium text-nw-fg1 whitespace-nowrap" title="${slug}">` +
    `<a href="/models/${slug}" class="hover:text-nw-accent-text hover:underline" data-model-row-link>Standard</a>${chip}` +
    `</div>` +
    `</td>` +
    `<td class="px-3 py-3 text-right align-top"><div class="nw-num text-nw-fg1">1.0 s</div></td>` +
    `</tr>`
  );
}

/** Second table ("Average energy per request"): NO lane/family data attributes. */
export function secondTableRow(display: string, chip = ""): string {
  return (
    `<tr class="group hover:bg-nw-surface-2 transition-colors">` +
    `<td class="sticky left-0 z-10 px-4 py-3"><div class="num text-nw-fg1 text-sm whitespace-nowrap">${display}${chip}</div></td>` +
    `<td class="px-3 py-3 text-right"><div class="nw-num">1.0 J</div></td>` +
    `</tr>`
  );
}

export function metricsTable(rows: string[]): string {
  return `<table class="w-full text-sm border-collapse min-w-[860px]"><thead><tr><th>Model</th><th>Dispatch wait</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

export function energyTable(rows: string[]): string {
  return `<table class="w-full text-sm border-collapse"><thead><tr><th>Model</th><th>Average energy</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

/**
 * Full perf-view fixture: metrics table (Standard siblings + lane rows) plus
 * the second table repeating every chip AND carrying chips for models that
 * have a lane but no chip in table 1 (leak tripwires).
 */
export function perfFixtureHtml(): string {
  const standardByModel = new Map(PERF_PREVIEW_STANDARD.map((p) => [p.slug as string, p]));
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const lane of PERF_LANES) {
    const preview = standardByModel.get(lane.slug);
    // Standard sibling row precedes the lane row on the live page.
    rows.push(standardRow(lane.slug, lane.family, preview ? previewChip(preview.display) : ""));
    rows.push(laneRow(lane.slug, lane.family, lane.flex ? FLEX_MARKER : speedMarker(lane.slug)));
    seen.add(lane.slug);
  }
  for (const p of PERF_PREVIEW_STANDARD) {
    if (seen.has(p.slug)) continue;
    rows.push(standardRow(p.slug, p.family, previewChip(p.display)));
  }
  const table2 = [
    secondTableRow("DeepSeek V4-Pro", previewChip("DeepSeek V4-Pro")),
    secondTableRow("DeepSeek V4.1 Flash", previewChip("DeepSeek V4.1 Flash")),
    secondTableRow("Kimi K3", previewChip("Kimi K3")), // leak tripwire: kimi-k3 has a flex-lane row, NO chip in table 1
    secondTableRow("Qwen3 Embedding 8B", previewChip("Qwen3 Embedding 8B")),
    secondTableRow("Ghost Model", previewChip("Ghost Model")),
  ];
  return `<html><body>${metricsTable(rows)}<h2>Average energy per request</h2>${energyTable(table2)}</body></html>`;
}

// -------------------------------------------------------------------- v1 doc

export type V1Row = [
  id: string,
  display: string,
  provider: string,
  ctx: number,
  tier: "standard" | "flex",
  mult: number | null,
  input: number | null,
  output: number | null,
  cached: number | null,
];

/** The live 19-entry /v1/models snapshot (prices verbatim). */
export const V1_ROWS: readonly V1Row[] = [
  ["kimi-k2.7-code", "Kimi K2.7 Code", "MoonshotAI", 262128, "standard", null, 0.95, 4, 0.095],
  ["kimi-k2.7-code-fast", "Kimi K2.7 Code Fast", "MoonshotAI", 262128, "standard", null, 0.95, 4, 0.095],
  ["kimi-k2.7-code-flex", "Kimi K2.7 Code (flex)", "MoonshotAI", 262128, "flex", 0.65, 0.6175, 2.6, 0.06175],
  ["glm-5.3", "GLM 5.3", "ZhipuAI", 1048560, "standard", null, 1.45, 4.5, 0.145],
  ["glm-5.3-flex", "GLM 5.3 (flex)", "ZhipuAI", 1048560, "flex", 0.65, 0.9425, 2.925, 0.09425],
  ["glm-5.3-flash", "GLM-5.3 Flash", "ZhipuAI", 1048560, "standard", null, 0.15, 0.5, 0.03],
  ["glm-5.3-flash-flex", "GLM-5.3 Flash (flex)", "ZhipuAI", 1048560, "flex", 0.65, 0.0975, 0.325, 0.0195],
  ["qwen3.6-35b", "Qwen3.6 35B", "Qwen", 131056, "standard", null, 0.29, 1.15, 0.029],
  ["qwen3.6-35b-fast", "Qwen3.6 35B Fast", "Qwen", 131056, "standard", null, 0.29, 1.15, 0.029],
  ["qwen3.6-35b-flex", "Qwen3.6 35B (flex)", "Qwen", 131056, "flex", 0.65, 0.1885, 0.7475, 0.01885],
  ["deepseek-v4-flash", "DeepSeek V4 Flash", "DeepSeek", 1048560, "standard", null, 0.14, 0.28, 0.028],
  ["deepseek-v4-flash-flex", "DeepSeek V4 Flash (flex)", "DeepSeek", 1048560, "flex", 0.65, 0.091, 0.182, 0.0182],
  ["deepseek-v4-flash-speed", "DeepSeek V4 Flash (Speed)", "DeepSeek", 1048560, "standard", null, 0.14, 0.28, 0.028],
  ["gemma-4-31b", "Gemma 4 31B", "nvidia", 262128, "standard", null, 0.144, 0.42, 0.0144],
  ["kimi-k3", "Kimi K3", "MoonshotAI", 1048560, "standard", null, 3, 15, 0.3],
  ["kimi-k3-fast", "Kimi K3 Fast", "MoonshotAI", 1048560, "standard", null, 3, 15, 0.3],
  ["kimi-k3-flex", "Kimi K3 (flex)", "MoonshotAI", 1048560, "flex", 0.65, 1.95, 9.75, 0.195],
  ["qwen-3.8-27b", "Qwen 3.8 27B", "Qwen", 262128, "standard", null, 0.45, 3.2, 0.25],
  ["qwen-3.8-27b-flex", "Qwen 3.8 27B (flex)", "Qwen", 262128, "flex", 0.65, 0.2925, 2.08, 0.1625],
];

/** Trimmed inline /v1/models body (shape-identical to the live document). */
export function v1FixtureDoc(rows: readonly V1Row[] = V1_ROWS): unknown {
  return {
    object: "list",
    scope: "public",
    data: rows.map(([id, display, provider, ctx, tier, mult, input, output, cached]) => ({
      id,
      object: "model",
      owned_by: "neuralwatt",
      max_model_len: ctx,
      metadata: {
        display_name: display,
        provider,
        pricing: {
          input_per_million: input,
          output_per_million: output,
          cached_input_per_million: cached,
          currency: "USD",
          pricing_tbd: false,
          cached_input_is_default: true,
          service_tier: tier,
          flex_discount_multiplier: mult,
        },
      },
    })),
  };
}

// ------------------------------------------------------------- /models cards

export interface CardSpec {
  readonly family: string;
  readonly name: string;
  readonly provider: string;
  readonly flex: "1" | "0";
  /** data-price verbatim: USD per 1K INPUT tokens (the missing-space defect follows it). */
  readonly price: string;
  readonly energy: string;
  /** data-model-id values listed on the card, in page order (variant rows + primary). */
  readonly ids: readonly string[];
  /** Footer display values (2dp-rounded; data-price is the exact input). */
  readonly inputDisplay: string;
  readonly outputDisplay: string;
  /** Footer title prefix, e.g. "Cached input: $0.02/M tokens ..." — null = attribute omitted. */
  readonly cachedTitle: string | null;
  readonly previewEnrollHref?: string;
}

/**
 * The 11 live family cards in page order (8 data-flex="1", 14 ids total).
 * deepseek-v4.1-flash / gemma-4-31b / qwen3-embedding-8b values are pinned
 * verbatim from the live capture; the rest carry the live structure with the
 * v1-consistent prices.
 */
export const MODEL_CARDS: readonly CardSpec[] = [
  {
    family: "DeepSeek V4 Flash", name: "DeepSeek V4 Flash", provider: "DeepSeek", flex: "1",
    price: "0.00014", energy: "0.349", ids: ["deepseek-v4-flash"],
    inputDisplay: "$0.14/M", outputDisplay: "$0.28/M", cachedTitle: "Cached input: $0.03/M tokens \u2014 prompt-cache-hit traffic is billed at this rate",
  },
  {
    family: "DeepSeek V4 Pro", name: "DeepSeek V4-Pro", provider: "DeepSeek", flex: "0",
    price: "0.0006", energy: "0.912", ids: ["deepseek-v4-pro"],
    inputDisplay: "$0.60/M", outputDisplay: "$2.40/M",
    // No cached-input title on the live card — cached stays nullable.
    cachedTitle: null,
    previewEnrollHref: "/enroll/deepseek-v4-pro-preview",
  },
  {
    family: "DeepSeek V4.1 Flash", name: "DeepSeek V4.1 Flash", provider: "DeepSeek", flex: "1",
    price: "0.00015", energy: "0.322", ids: ["deepseek-v4.1-flash"],
    inputDisplay: "$0.15/M", outputDisplay: "$0.60/M", cachedTitle: "Cached input: $0.02/M tokens \u2014 prompt-cache-hit traffic is billed at this rate",
    previewEnrollHref: "/enroll/deepseek-v41-flash-preview",
  },
  {
    family: "GLM-5.3", name: "GLM 5.3", provider: "ZhipuAI", flex: "1",
    price: "0.00145", energy: "1.204", ids: ["glm-5.3"],
    inputDisplay: "$1.45/M", outputDisplay: "$4.50/M", cachedTitle: "Cached input: $0.15/M tokens \u2014 prompt-cache-hit traffic is billed at this rate",
  },
  {
    family: "GLM-5.3 Flash", name: "GLM-5.3 Flash", provider: "ZhipuAI", flex: "1",
    price: "0.00015", energy: "0.214", ids: ["glm-5.3-flash"],
    inputDisplay: "$0.15/M", outputDisplay: "$0.50/M", cachedTitle: "Cached input: $0.03/M tokens \u2014 prompt-cache-hit traffic is billed at this rate",
  },
  {
    family: "Kimi K2.7 Code", name: "Kimi K2.7 Code", provider: "MoonshotAI", flex: "1",
    price: "0.00095", energy: "0.640", ids: ["kimi-k2.7-code", "kimi-k2.7-code-fast"],
    inputDisplay: "$0.95/M", outputDisplay: "$4.00/M", cachedTitle: "Cached input: $0.10/M tokens \u2014 prompt-cache-hit traffic is billed at this rate",
  },
  {
    family: "Kimi K3", name: "Kimi K3", provider: "MoonshotAI", flex: "1",
    price: "0.003", energy: "2.005", ids: ["kimi-k3", "kimi-k3-fast"],
    inputDisplay: "$3.00/M", outputDisplay: "$15.00/M", cachedTitle: "Cached input: $0.30/M tokens \u2014 prompt-cache-hit traffic is billed at this rate",
  },
  {
    family: "Qwen 3.8 27B", name: "Qwen 3.8 27B", provider: "Qwen", flex: "1",
    price: "0.00045", energy: "0.511", ids: ["qwen-3.8-27b"],
    inputDisplay: "$0.45/M", outputDisplay: "$3.20/M", cachedTitle: "Cached input: $0.25/M tokens \u2014 prompt-cache-hit traffic is billed at this rate",
  },
  {
    family: "Qwen3.6 35B", name: "Qwen3.6 35B", provider: "Qwen", flex: "1",
    price: "0.00029", energy: "0.402", ids: ["qwen3.6-35b", "qwen3.6-35b-fast"],
    inputDisplay: "$0.29/M", outputDisplay: "$1.15/M", cachedTitle: "Cached input: $0.03/M tokens \u2014 prompt-cache-hit traffic is billed at this rate",
  },
  {
    family: "Gemma 4 31B", name: "Gemma 4 31B", provider: "nvidia", flex: "0",
    price: "0.000144", energy: "0.188", ids: ["gemma-4-31b"],
    inputDisplay: "$0.14/M", outputDisplay: "$0.42/M", cachedTitle: "Cached input: $0.01/M tokens \u2014 prompt-cache-hit traffic is billed at this rate",
  },
  {
    family: "qwen3-embedding-8b", name: "Qwen3 Embedding 8B", provider: "Qwen", flex: "0",
    price: "0.000045", energy: "0.030", ids: ["qwen3-embedding-8b"],
    inputDisplay: "$0.05/M", outputDisplay: "$0.00/M", cachedTitle: "Cached input: $0.00/M tokens \u2014 prompt-cache-hit traffic is billed at this rate",
  },
];

/** One family card: attrs wrapped across lines, missing-space defect verbatim. */
export function cardHtml(spec: CardSpec): string {
  const idlist = spec.ids
    .map(
      (id, i) =>
        `      <a href="/models/${id}" class="nw-id flex items-center justify-between rounded-md px-2 py-1 text-xs hover:bg-nw-surface-2"` +
        ` data-model-id="${id}" data-model-action="${i === 0 ? "primary" : "variant"}">` +
        `<span class="font-mono">${id}</span></a>`,
    )
    .join("\n");
  // Details link repeats the primary id — the dedupe probe.
  const detailsLink =
    `      <a href="/models/${spec.ids[0]}" class="text-xs text-nw-fg3 hover:underline"` +
    ` data-model-id="${spec.ids[0]}" data-model-action="details">details</a>`;
  const titleAttr = spec.cachedTitle == null ? "" : ` title="${spec.cachedTitle}"`;
  const previewChip = spec.previewEnrollHref
    ? `\n` +
      `    <div class="flex items-center gap-2"><a href="${spec.previewEnrollHref}"` +
      ` class="inline-block px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-medium rounded-full">Preview</a></div>`
    : "";
  return (
    `<article class="nw-card nw-card-hover flex h-full flex-col gap-3.5"\n` +
    `  data-family="${spec.family}"\n` +
    `  data-name="${spec.name}"\n` +
    `  data-provider="${spec.provider}"\n` +
    `  data-search="${spec.name.toLowerCase()}"\n` +
    `  data-reasoning="0"\n` +
    `  data-vision="0"\n` +
    `  data-tools="1"\n` +
    `  data-flex="${spec.flex}"\n` +
    `  data-price="${spec.price}"data-energy="${spec.energy}"\n` +
    `  data-ctx="1048560"\n` +
    `  data-popular="0">\n` +
    `  <div class="flex items-baseline justify-between gap-2">\n` +
    `    <h3 class="nw-card-title">${spec.name}</h3>\n` +
    (spec.flex === "1"
      ? `    <span class="nw-tag nw-tag-sm nw-tag-blue" title="Flex tier \u2014 opt-in via the -flex service tier.">Flex</span>\n`
      : "") +
    `  </div>\n` +
    `  <div class="grid grid-cols-2 gap-2">\n` +
    `    <div class="nw-tile"><span>Input</span><strong>${spec.inputDisplay.replace("/M", "")}</strong></div>\n` +
    `    <div class="nw-tile"><span>Output</span><strong>${spec.outputDisplay.replace("/M", "")}</strong></div>\n` +
    `  </div>\n` +
    previewChip +
    `  <div class="nw-idlist flex flex-col gap-1">\n` +
    idlist +
    `\n` +
    detailsLink +
    `\n  </div>\n` +
    `  <div class="mt-auto flex justify-between items-center text-xs text-nw-fg3 cursor-help"${titleAttr}>\n` +
    `    <span>Input: <strong class="nw-num">${spec.inputDisplay}</strong></span>\n` +
    `    <span>Output: <strong class="nw-num">${spec.outputDisplay}</strong></span>\n` +
    `  </div>\n` +
    `</article>`
  );
}

/** Full /models fixture: the decoy proves the article[data-family] scope probe. */
export function cardsFixtureHtml(): string {
  const cards = MODEL_CARDS.map(cardHtml).join("\n");
  return (
    `<html><body><main class="grid grid-cols-3 gap-4">\n` +
    `<section data-family="decoy non-article element must be ignored by the article-scoped probe"></section>\n` +
    cards +
    `\n</main></body></html>`
  );
}
