# NeuralDash — Energy Board

Live NeuralWatt **energy-per-request** board inside VS Code. Shows `Right now` and `7-day typical` energy, per-size breakdowns, 48-hour trend charts, and a value ranking (`performanceScore / mWh`) with status-bar pinning.

<!-- Preview screenshot lives at docs/prototype-48h-trend.png — re-enable this image once the project has a public repository URL (vsce resolves README images against it). -->

## Features

- Tree view `NeuralWatt` → `Energy Board` lists all models with energy and cost per 1k requests.
- **48h trend chart** — right-click a model row (or use the tooltip link) to open a chart panel rendering the full 48-hour trendline with reference line and trend coloring.
- Rich, sticky tooltips: full per-band table, colored 48h trend summary, cache hit %, benchmark value, plus `Copy Slug` and `Open Pricing Page` actions.
- Value ranking: `value = performanceScore / basisMwh` (basis from `preferredBand`).
- Status bar — pins your chosen model (`neuraldash.myModel`) as `⚡ <name> · 245.48 mWh · $2.45/1k`.
- Flex tiers — live registry pricing for `-flex` variants not on the live board.
- Polling with ETag / `If-None-Match`, 30s timeout, failure backoff (cap 120 min).

> **Note:** NeuralDash is unofficial and reads the public NeuralWatt energy-pricing page directly (no API). If the page's structure changes, parsing may need an update — the board keeps serving its last cached data meanwhile.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `neuraldash.pollIntervalMinutes` | `20` (min `5`) | Poll interval in minutes |
| `neuraldash.tariffPerKWh` | `10.00` | USD per kWh for cost display |
| `neuraldash.preferredBand` | `typical` | Basis for ranking: `typical` \| `auto` \| `0-256` \| `256-1k` \| `1k-4k` \| `4k-16k` \| `16k-64k` \| `64k-256k` \| `256k-1M` |
| `neuraldash.myModel` | `""` | Model slug shown in status bar |
| `neuraldash.scoresOverridePath` | `""` | Absolute path to JSON overriding `data/scores.json` (user-wins per slug) |

## Scores

`data/scores.json` schema:

```json
{
  "version": 1,
  "scores": {
    "deepseek-v4-flash": { "performanceScore": 82.5, "source": "https://example.com/bench", "asOf": "2026-08-20" }
  }
}
```

- `performanceScore`: 0–100 (higher is better).
- Only **honest** entries with a real public `source` and `asOf` date. Empty `scores: {}` is valid — models without a benchmark show `no benchmark`.
- Override file at `scoresOverridePath` is merged per-slug, user-wins. Missing/malformed override falls back to bundled.

## Commands

- `NeuralDash: Refresh Board`
- `Sort by Energy` / `Sort by Value` / `Sort by Name`
- `Pick Best Value`
- `Set My Model`
- `Open 48h Trend Chart` (also via row right-click and the tooltip link)
- `Copy Model Slug` (via the tooltip link)
- `Open Pricing Page`

## Flex tiers (live registry)

The Flex tiers section prices `-flex` variants not on the live board. Pricing refreshes live from
`https://models.dev/api.json` on every board refresh cycle (cheap `304` when unchanged), with the last
live fetch cached to global storage and the bundled `data/models-registry.json` as offline fallback.
The flex tooltip `Source` row shows provenance: `(live, fetched …)`, `(cached …)`, or `bundled registry (…)`.
Registry failures are silent — the board never waits on or reports them.

## Development

```sh
npm install
npm run compile      # tsc -p .
npm test             # tsc -p . && node --test out/test/
npm run watch
npx @vscode/vsce package --allow-missing-repository
```
