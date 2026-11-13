# NeuralDash — Energy Board

Live NeuralWatt **energy-per-request** board inside VS Code. Shows `Right now` and `7-day typical` energy, per-size breakdowns, 48-hour trend charts, and a value ranking (`performanceScore / mWh`) with status-bar pinning.

> **Unofficial.** NeuralDash is an independent community extension and is not affiliated with or endorsed by Neuralwatt. It only reads Neuralwatt's public pricing pages and the public `/v1/models` catalog; it sends no data and needs no account or API key.

<!-- Preview screenshot lives at docs/prototype-48h-trend.png — re-enable this image once the project has a public repository URL (vsce resolves README images against it). -->

## Features

- Tree view `NeuralWatt` → `Energy Board` lists all models with mode-aware metrics (Bang for Buck, Fastest, Lowest Price). Energy is shown in μWh, mWh or Wh to fit the value. Models the board publishes no energy for sit in a collapsed `No energy data` section.
- **Performance metrics** — parses live first-token latency (TTFT p50/p95 with fast/mid/slow dot), throughput (p50/p95 tok/s), 7d cache hit %, and Flex dispatch wait from `https://portal.neuralwatt.com/energy-pricing?view=performance`.
- **48h trend view** — click any model or Flex row (or use the tooltip link) to show the sidebar `48h Trend` Telemetry Bento with average-colored KPIs, 48-hour energy & throughput SVG charts with right-side indicator tags, and tracking-alias resolution (`alias → backend`).
- Rich, sticky tooltips: compact per-band table, colored 48h trend summary, TTFT/throughput/cache hit %, benchmark value, plus `Copy Slug` and `Open Pricing Page` actions.
- **Thinking line** on model and Flex tooltips, read from Neuralwatt's `/v1/models` catalog: whether the model thinks, whether it's always on, on by default or off by default, the default effort, and the effort levels it accepts (verbatim, ready for `reasoning_effort`). A lane with thinking off also shows what other lanes on the same weights do. Models the catalog doesn't list show no line.
- **3-mode sort** (`NeuralDash: Set Sort Order`): **Bang for Buck** (`throughput p50 ÷ energy`, default), **Fastest** (`throughput p50` desc, TTFT tiebreak), and **Lowest Price** (`energy` asc, cost tiebreak). Applies to both main models and Flex tiers.
- Status bar — shows `neuraldash.myModel` when set, or pins the `#1` model under the active sort mode as `⚡ <name> · <p50> tok/s · <energy> (<mode>)`.
- Flex tiers — Neuralwatt's flex-tier models retrieved live from the catalog, sorted by the active mode and inspectable in the `48h Trend` view at subsidized energy.
- Polling with SHA-256 change detection, 30s timeout, failure backoff (cap 120 min).

> **Note:** NeuralDash is unofficial and reads the public NeuralWatt energy-pricing page directly (energy pricing is HTML-only; the model catalog comes from Neuralwatt's public `/v1/models` API). If the page's structure changes, parsing may need an update — the board keeps serving its last cached data meanwhile.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `neuraldash.pollIntervalMinutes` | `20` (min `5`) | Poll interval in minutes |
| `neuraldash.tariffPerKWh` | `10.00` | USD per kWh for cost display |
| `neuraldash.preferredBand` | `typical` | Basis for ranking: `typical` \| `auto` \| `0-256` \| `256-1k` \| `1k-4k` \| `4k-16k` \| `16k-64k` \| `64k-256k` \| `256k-1M` |
| `neuraldash.myModel` | `""` | Model slug shown in status bar |
| `neuraldash.scoresOverridePath` | `""` | Absolute path to JSON overriding `data/scores.json` (user-wins per slug) |

## Scores

Live scores come from the [Epoch Capabilities Index (ECI)](https://epoch.ai/eci), read from Epoch AI's [benchmark data download](https://epoch.ai/benchmarks/use-this-data) (`https://epoch.ai/data/benchmark_data.zip`, `epoch_capabilities_index/eci_scores.csv`) at most once a day. Data © Epoch AI, used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Board models are matched to ECI rows by normalized name (slug, then display name, then family); ambiguous or unknown models stay `no benchmark`. Each tooltip names the ECI row it used.

Bundled and override scores take precedence over live ECI scores. `data/scores.json` schema:

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
- `NeuralDash: Set Sort Order` (`Bang for Buck` / `Fastest` / `Lowest Price`)
- `Pick Best Value`
- `Set My Model`
- `Open 48h Trend Chart` (also via row right-click and the tooltip link)
- `Copy Model Slug` (via the tooltip link)
- `Open Pricing Page`

## Flex tiers (live catalog)

The Flex tiers section lists Neuralwatt's flex-tier models, retrieved automatically on every board
cycle from `https://api.neuralwatt.com/v1/models` and the energy-pricing performance view
(per-model flex lanes + preview chips). Membership, pricing, and preview status are enumerated
from those documents — nothing is hardcoded, so the section follows the portal as models rotate.
Pricing provenance is labeled per row: exact alias → models.dev alias → `N× derived` (multiplier
harvested from the catalog) → portal `/models` card → TBD with a reason. The tooltip `Source`
row names the exact documents and fetch times, and `NeuralDash: Debug Flex` dumps the full
evidence chain. Catalog failures are silent — the board never waits on or reports them.

## Development

```sh
npm install
npm run compile      # tsc -p .
npm test             # tsc -p . && node --test out/test/
npm run watch
npx @vscode/vsce package
```

Commits are scanned by local PII hooks; see [CONTRIBUTING.md](CONTRIBUTING.md) for setup.
