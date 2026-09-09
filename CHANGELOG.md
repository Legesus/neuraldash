# Changelog

All notable changes to NeuralDash are documented here.

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
