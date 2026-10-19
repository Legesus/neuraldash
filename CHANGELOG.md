# Changelog

All notable changes to NeuralDash are documented here.

## 0.4.17 — 2026-10-19

Board readability for brand-new and fast-lane models:

- **New models never render as raw slugs** — when a board entry is unknown to every fetched catalog (API display name, registry, `/models` cards), its slug is mechanically formatted for display (`clef-flash` → `Clef Flash`). No name table: real catalog names outrank the formatting the moment any document learns the id, and a scraped publisher title always wins.
- **Energy order follows the number shown** — the board sorted by 7-day typical energy while displaying live right-now energy, so fast/speed/flash lanes (whose live usage diverges hardest from typical) broke the cheapest→most-expensive trend. Energy ordering and severity colors now follow the displayed right-now value (typical as fallback); value ranking and best-value star stay on the typical basis so they don't reshuffle with intraday noise.
- Activity-bar title corrected to NeuralDash.

## 0.4.16 — 2026-09-18

Flex tiers now retrieve automatically from Neuralwatt's own catalog — zero hardcoded model data:

- **Live flex catalog** — flex membership, pricing, and preview status are enumerated on every board poll from `https://api.neuralwatt.com/v1/models` and the energy-pricing performance view (per-model flex lanes, preview chips). The old models.dev `-flex` slug heuristic is gone: retired models can no longer ghost in the section and newly flex-tagged models appear on the next fetch. models.dev remains as a metadata/pricing fallback only.
- **Per-row pricing provenance** — each flex row is priced by a labeled chain: exact `/v1/models` alias pricing → models.dev alias → standard × harvested flex multiplier (`0.65× derived`) → portal `/models` card prices (`portal-card`: input exact, output display-rounded) → "pricing TBD" with a stated reason. The multiplier itself is harvested from the documents, never a constant.
- **Preview models priced** — flex-capable preview models absent from the API (e.g. `deepseek-v4.1-flash`) show derived card pricing with an explicit provenance label instead of "pricing TBD".
- **Board display names restored** — Neuralwatt's board now ships raw model slugs in its HTML, so rows are joined against the fetched catalogs (API display name → registry → card) for proper names; slug-based actions (copy slug, chart, my-model) are unchanged.
- **`NeuralDash: Debug Flex`** — dumps the full per-row evidence chain (source documents, fetch times, prices, multiplier harvest) to an output channel.
- Consistent labels — every flex row carries the `(flex)` marker, sourced verbatim from Neuralwatt where available.
- A blocking test keeps model-name and multiplier literals out of the flex sources (`test/grepInvariant.test.ts`).

## 0.4.11 — 2026-09-07

Release hygiene:

- Added this `CHANGELOG.md`.
- README refreshed for the 0.4.x feature set (48h trend chart panel, tooltip actions, flex tiers).
- Design-scratch SVGs excluded from the packaged VSIX; local artifacts ignored.
- `NeuralDash: Debug Tooltip Markdown` hidden from the command palette (still callable by id for diagnostics).

## 0.4.10 — 2026-09-07

The 48h trend chart moved to a reliable surface:

- **`Open 48h chart`** — tooltip link + right-click command on model rows opens a chart panel (beside the editor) rendering the full 48h trend at 400×104, with right-now / typical / cost stats and trend coloring.
- TreeItem tooltips are now **text-only by design**: VS Code's hover renderer drops images (SVG blocked by policy; raster images silently dropped), so the dead image slot was removed in favor of the panel.
- Security hardening: the tooltip is *trusted* markdown, so model-derived fields (name, slug, context) are now HTML-escaped — a hostile model name can no longer inject markup into the hover. Command-link arguments force-encode parentheses so unusual slugs cannot break link destinations.

## 0.4.9 — 2026-09-04

- Fixed colored trend text: VS Code's hover sanitizer requires a trailing semicolon in `style` values (`color:#fb7185;`), otherwise the whole style is stripped and text renders uncolored.

## 0.4.8 — 2026-09-04

- Added the `NeuralDash: Debug Tooltip Markdown` diagnostic (output channel dump of the exact tooltip markdown — used to trace the hover-image investigation).

## 0.4.7 — 2026-09-04

- Tooltip chart switched from SVG to a **dependency-free PNG rasterizer** (`sparklinePng.ts`: 400×104 RGBA backing store, dotted reference line, trend-colored polyline, last-point dot — `node:zlib` only, no native modules). SVG retained as a fallback path for the chart panel.

## 0.4.6 — 2026-09-04

- Sticky tooltips + `Copy Slug` / `Open Pricing Page` footer extended to flex-tier rows (slugs from the models.dev registry).

## 0.4.5 — 2026-09-04

- **`Copy Slug`** button in model-row tooltips (copies the model slug, status-bar confirmation).
- **Sticky tooltips**: footer links flip VS Code's tree hover to interactive mode, so the tooltip can be moused into and read.

## 0.4.0 – 0.4.4 — 2026-09-04

- **48h trendline support**: the scraper now parses the live page's embedded 48h sparkline (polyline points, reference line, direction, min/max labels) into each model quote.
- Tooltip `48h trend` row: colored direction text + lo/hi range.
- Simplified row descriptions (value · cost · trend %; ranges live in the tooltip).
- Column widths, trend rows, and diagnostics iterated across 0.4.1–0.4.4.

## 0.3.0 — 2026-09-04

- Live `models.dev` registry fetch for flex-tier pricing (etag/304 support, cached stale-first, bundled fallback).
- README, packaging gate, release baseline.
