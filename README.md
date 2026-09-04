# NeuralDash — Energy Board

Live NeuralWatt **energy-per-request** board inside VS Code. Shows `Right now` and `7-day typical` energy, per-size breakdowns, and a value ranking (`performanceScore / mWh`) with status-bar pinning.

## Features

- Tree view `NeuralWatt` → `Energy Board` lists all models with energy and cost per 1k requests.
- Tooltips with full per-band table, trend, cache hit %, and benchmark value.
- Value ranking: `value = performanceScore / basisMwh` (basis from `preferredBand`).
- Status bar — pins your chosen model (`neuraldash.myModel`) as `⚡ <name> · 245.48 mWh · $2.45/1k`.
- Polling with ETag / `If-None-Match`, 30s timeout, failure backoff (cap 120 min).

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
- `Open Pricing Page`

## Development

```sh
npm install
npm run compile      # tsc -p .
npm test             # tsc -p . && node --test out/test/
npm run watch
npx @vscode/vsce package --allow-missing-repository
```
