# Contributing

## PII protection

Commits pass through a local PII guard so personal information and secrets never enter the repository — or its history. The `pre-commit`, `commit-msg`, and `pre-push` hooks scan staged diffs, commit messages, and every outgoing commit; a ZCode `PreToolUse` guard (`.githooks/zcode-pretooluse.mjs`, wired via `.zcode/config.json`) additionally checks any `git commit` command before it runs.

The guard blocks by category: private keys, API keys and tokens, bearer tokens, government-ID-shaped numbers, street addresses, local home-directory paths, personal identity tokens, and private email addresses. Findings are reported as location + category only — matched text is never printed.

After a fresh clone, activate the hooks once:

```sh
git config core.hooksPath .githooks
```

The committed `.githooks/pii-patterns.txt` holds generic shapes only. Identity tokens and personal email addresses live in a private overlay, `.githooks/pii-patterns.local.txt`, which is **never committed**: it is kept out of git per clone via `.git/info/exclude`, so it stays on your machine.

To add patterns, append one regex per line under a `# CATEGORY:` header in either file. The dialect is POSIX ERE that also compiles as a JavaScript `RegExp` body: use explicit character classes and the `(^|[^A-Za-z0-9_])…([^A-Za-z0-9_]|$)` boundary idiom — no `\b`, `\d`, `\s`, and no lookarounds.

- **Bypass policy:** none. `--no-verify` is denied inside ZCode sessions, and the ZCode guard re-checks `git commit` commands against the same patterns.
- **False positives:** tighten the offending pattern in your local overlay — never delete a category.
- **Identity:** keep your repo-local git identity public (set the name and email with `git config --local`); the guard blocks the commit when a commit identity matches a private pattern.

