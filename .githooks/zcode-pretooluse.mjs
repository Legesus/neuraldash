#!/usr/bin/env node
/**
 * ZCode PreToolUse PII guard.
 *
 * Inspects Bash tool calls that would run `git commit` and blocks them when
 * the command string, the current working-tree diff (staged + unstaged), or a
 * --no-verify / -n bypass shows PII or secrets. Mirrors the semantics of
 * .githooks/_scan.sh so the same patterns protect ZCode-driven sessions.
 *
 * stdin  : ZCode PreToolUse JSON payload
 * stdout : always empty
 * exit   : 0 = allow (or silently ignore), 2 = block
 *
 * Fail-open ONLY for malformed/empty payloads or non-git-commit commands;
 * every pattern/internal failure fails closed with exit 2.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK_DIR = new URL('.', import.meta.url);

function loadCategories() {
  const categories = [];
  const load = (fileName, required) => {
    const url = new URL(fileName, HOOK_DIR);
    if (!existsSync(url)) {
      if (required) {
        process.stderr.write(`PII guard internal error: ${fileName} not found\n`);
        process.exit(2);
      }
      return; // private overlay is optional per clone
    }
    let current = 'misc';
    for (const raw of readFileSync(url, 'utf8').split('\n')) {
      const line = raw.replace(/\r$/, '');
      const trimmed = line.trim();
      if (trimmed === '') continue;
      if (trimmed.startsWith('#')) {
        const m = trimmed.match(/^#[ \t]*CATEGORY:[ \t]*(.+)$/i);
        if (m) {
          const name = m[1].trim().replace(/[^A-Za-z0-9_-]/g, '_');
          if (name && name !== '_') current = name;
        }
        continue;
      }
      let re;
      try {
        re = new RegExp(line, 'i');
      } catch {
        process.stderr.write(`PII guard internal error: invalid pattern in ${fileName}\n`);
        process.exit(2);
      }
      let cat = categories.find((c) => c.name === current);
      if (!cat) {
        cat = { name: current, regexes: [] };
        categories.push(cat);
      }
      cat.regexes.push(re);
    }
  };
  load('pii-patterns.txt', true);
  load('pii-patterns.local.txt', false);
  return categories;
}

function hit(categories, text) {
  for (const cat of categories) {
    for (const re of cat.regexes) {
      if (re.test(text)) return cat.name;
    }
  }
  return null;
}

function gitRoot() {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// JS mirror of the awk annotator in .githooks/_scan.sh: added lines only.
function addedLines(diffText) {
  const out = [];
  let path = null;
  let nline = 0;
  let inHeader = false;
  let expectNew = false;
  let inBinary = false;
  for (const raw of diffText.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) {
      path = null; nline = 0; inHeader = true; expectNew = false; inBinary = false;
      continue;
    }
    if (line.startsWith('--- ')) {
      if (inHeader) expectNew = true;
      continue;
    }
    if (line.startsWith('+++ ') && inHeader && expectNew) {
      expectNew = false;
      path = null;
      const rest = line.slice(4);
      if (rest !== '/dev/null') {
        const p = rest.slice(2); // strip the "b/" prefix
        if (!p.startsWith('.githooks/pii-patterns')) path = p;
      }
      continue;
    }
    if (line.startsWith('@@')) {
      inHeader = false;
      const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @/);
      if (m && path) nline = parseInt(m[1], 10);
      continue;
    }
    if (line === 'GIT binary patch' || line.startsWith('Binary files ')) {
      inBinary = true;
      inHeader = false;
      continue;
    }
    if (line.startsWith('+')) {
      if (!inBinary && path && nline > 0) out.push({ path, line: nline, text: line.slice(1) });
      nline += 1;
      continue;
    }
    if (line.startsWith('-')) continue;
    if (line.startsWith(' ')) {
      if (!inBinary) nline += 1;
      continue;
    }
  }
  return out;
}

// --- main ------------------------------------------------------------------

let payload;
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // malformed/empty payload: fail open ONLY here
}

const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name : '';
if (!toolName.toLowerCase().includes('bash')) process.exit(0);

const command = typeof payload?.tool_input?.command === 'string' ? payload.tool_input.command : '';
if (command === '') process.exit(0);

// Only act on commands containing a git-commit segment.
const segments = command.split(/&&|\|\||;|\||\r?\n/);
const commitSegments = segments.filter((s) => /(^|\s)git\s+commit(\s|$)/.test(s));
if (commitSegments.length === 0) process.exit(0); // stay completely silent

// Bypass attempt: --no-verify token or standalone -n flag.
for (const seg of commitSegments) {
  if (/(^|\s)--no-verify(\s|$)/.test(seg) || /(^|\s)-n(\s|$)/.test(seg)) {
    process.stderr.write('PII guard: --no-verify is not allowed; hooks cannot be bypassed in this workspace\n');
    process.exit(2);
  }
}

const categories = loadCategories();

// 1) Scan the command string itself.
for (const line of command.split('\n')) {
  const cat = hit(categories, line);
  if (cat) {
    process.stderr.write(`command string [${cat}]\n`);
    process.exit(2);
  }
}

// 2) Scan the working-tree diff (staged + unstaged) the commit would include.
const cwd = process.env.ZCODE_PROJECT_DIR || gitRoot();
if (cwd) {
  const diffOpts = { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  let diff = spawnSync('git', ['diff', 'HEAD', '--diff-filter=ACMR', '-U0'], diffOpts);
  if (diff.error || diff.status !== 0) {
    // `git diff HEAD` fails on an unborn HEAD (the very first commit); the
    // staged diff is then exactly what the commit would include.
    diff = spawnSync('git', ['diff', '--cached', '--diff-filter=ACMR', '-U0'], diffOpts);
  }
  if (diff.error || diff.status !== 0) {
    process.stderr.write('PII guard internal error: git diff failed\n');
    process.exit(2);
  }
  if (diff.stdout) {
    for (const added of addedLines(diff.stdout)) {
      const cat = hit(categories, added.text);
      if (cat) {
        process.stderr.write(`${added.path}:${added.line} [${cat}]\n`);
        process.exit(2);
      }
    }
  }
}

process.exit(0);
