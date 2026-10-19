# NeuralDash — Project Agent Instructions

NeuralDash is a VS Code extension (publisher `Legesus`) that renders Neuralwatt's live energy-per-request board as a TreeView, ranks models by value (benchmark score ÷ mWh), shows Flex-tier rows, and opens a 48h-trend webview chart. TypeScript, zero runtime deps beyond `node-html-parser`, distributed via GitHub Releases and Open VSX.

## No hardcoded data — absolute rule

This extension **cannot ship hardcoded Neuralwatt domain data. Ever.** That means no literals in source for:

- model identifiers or slugs (`kimi`, `glm-…`, `qwen`, `deepseek`, …)
- vendor or model display names
- prices, flex discounts, or the flex multiplier (`0.65` or any other number)
- energy values, latencies, or any other measurements
- flex membership lists or tier structure

Everything above is **enumerated from fetched documents at runtime** (`/v1/models` JSON, the energy-pricing board, the perf view, the `/models` portal cards). If a change seems to require a literal, the correct fix is to derive it from a fetched source or add a new fetched source — never to add a constant, and never to add an exception to the invariant test. Display literals that are UI chrome (column headers, command titles, unit suffixes like `mWh`) are fine; anything that states a *fact about Neuralwatt's catalog* is not.

`test/grepInvariant.test.ts` enforces this on the flex pipeline sources and is blocking. Extending its coverage is welcome; weakening it is forbidden. The pre-existing baked table in `src/core/registry.ts` is documented out-of-scope legacy — do not follow it as a pattern, and do not add to it.

## Commands

- `npm run compile` — `tsc -p .`
- `npm test` — compiles, then `node --test out/test/*.test.js` (23 suites, ~300 tests; plain `node:test`, no VS Code host needed)
- `npm run watch` — tsc watch
- No linter is configured. `npm test` is the gate.

## Architecture

- `src/extension.ts` — activation entry point
- `src/controller.ts` — orchestration (polling, sorting, status bar)
- `src/providers/` — data sources (Neuralwatt HTML board, `/v1/models` JSON catalog, registry)
- `src/ui/` — tree views and presentation
- `src/core/` — **pure, VS-Code-free logic** (everything testable under plain node). Keep `vscode` imports out of `core/`; UI concerns stay above it.
  - `parse.ts` board HTML parsing · `energy.ts` units/derivation · `ranking.ts` value = score ÷ mWh
  - `flex*.ts` the Flex catalog pipeline (membership, pricing, cards, cache, diagnostics)
  - `registry*.ts` models-registry transform + cache · `scores.ts` benchmark scores · `displayNames.ts` · `sparkline*`/`chartPanel.ts` 48h chart
- `test/grepInvariant.test.ts` — see Blocking invariants below
- `data/scores.json` ships **empty by design** (`{"scores": {}}`); rows show "no benchmark" until a licensed score source lands. Users can override via `neuraldash.scoresOverridePath`.
- `*.vsix` at the repo root are local build artifacts (gitignored). Never commit or publish test builds.

## Data-source truth rules — read before touching anything data-related

The board is scraped from Neuralwatt's **energy-pricing HTML page**; energy pricing has no JSON API. These rules exist because each one was violated or nearly violated once:

1. **Never parse `?view=performance` as the board.** In the performance view `td[1]` is latency, not energy — it silently corrupts every value. Board rows come from the energy view only.
2. **Flex membership source ranking:** per-ID `data-perf-lane` flex tags in the perf view (authoritative) > `/v1/models` exact `-flex` pricing > `/models` family badges (over-includes fast variants — never use alone).
3. **`/v1/models`** is the anonymous keyless OpenAI-style JSON catalog — exact flex pricing and `flex_discount_multiplier` come from there. It is not the board.
4. **Never treat models.dev as flex ground truth** — it is structurally stale for this data.
5. **No HTTP validators** (ETag/If-Modified-Since). Change detection is SHA-256 over the raw body; keep it that way.
6. **Provenance is a feature:** every displayed number must stay traceable to an endpoint + fetch time (tooltip Source lines, `neuraldash.debugFlex` evidence dump). Name exact endpoints in commits/PRs that change displayed data.

## Blocking invariants

`test/grepInvariant.test.ts` is the enforcement arm of the no-hardcoding rule above: it fails the suite on model-identifier literals (`kimi|glm-|qwen|deepseek|gemma`) or numeric multiplier literals (e.g. `0.65`) in the flex pipeline sources. If this test goes red, the fix is to derive the value from the fetched source — never a constant, never a test exception.

## Git, PII hooks, and identity

- `core.hooksPath` points at `.githooks/`: pre-commit / commit-msg / pre-push scan for PII and identity literals (`pii-patterns.txt`). **Never commit with `--no-verify`** (a PreToolUse guard denies it anyway).
- The author runs commits in parallel with agent pipelines. Before declaring a suite red or a state broken: `git status` + `git log`, re-run tests, attribute changes before reacting. Never touch uncommitted WIP that isn't yours.

## Packaging & publishing

- vsce gotchas hit here: README images require the `repository` field; CHANGELOG gets lowercased in the package; LICENSE is renamed `LICENSE.txt` inside the VSIX; untracked dot-dirs get swept into the package — keep `.vscodeignore` current.
- Publishing flow: bump version → CHANGELOG → `vsce package` → GitHub Release → Open VSX (web dialog or `ovsx`). The Marketplace listing is blocked on Microsoft's "suspicious content" flag (manual review via VSMarketplace@microsoft.com) — do not retry rapid re-uploads.

## Platform quirks

**Windows / Git Bash**

- `grep` is ugrep: no lookaheads, and leading-`/` patterns parse as options. `|| fallback` can fire on syntax errors, not just no-match — check exit codes.
- Node scripts resolve `/tmp` to `C:\tmp`; use absolute `os.tmpdir()`-based paths.

**VS Code UI**

- TreeItem hover images never render in any data-URI form — data belongs in a webview panel (see `chartPanel.ts`).
- There are **two tooltip assembly paths** (model rows and flex rows). Any hover/markdown change must be applied to both.
- Trusted-tooltip markdown must HTML-escape `& < >`; `span style` regexes need the trailing semicolon; force-encode `(` `)` as `%28`/`%29` in data URIs.
