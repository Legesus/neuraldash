# shellcheck shell=sh
#
# _scan.sh — PII guard shared library for the .githooks hooks.
#
# Sourced (not executed) by pre-commit / commit-msg / pre-push after they have
# cd'd to the repository top level. Callers then run `pii_init` once, followed
# by the scan/report functions.
#
# Design rules:
#   * Fail closed: every internal error exits 2.
#   * Findings are recorded as "<location> [<category>]" only. Matched content
#     is never echoed anywhere.
#   * Patterns come from .githooks/pii-patterns.txt (committed) plus the
#     optional private overlay .githooks/pii-patterns.local.txt (per clone;
#     missing overlay degrades silently).
#   * Honors ${GREP} (defaults to "grep").
#
# Public functions: pii_init, pii_scan_text, pii_scan_annotated_stream,
#                   pii_report.

PII_PATTERNS_FILE=".githooks/pii-patterns.txt"
PII_PATTERNS_LOCAL=".githooks/pii-patterns.local.txt"
PII_TMPDIR=""
PII_MERGED=""
PII_FINDINGS=""
# Preserve a caller-provided GREP override; pii_init defaults it to "grep".
GREP="${GREP:-}"

pii_cleanup() {
  if [ -n "$PII_TMPDIR" ] && [ -d "$PII_TMPDIR" ]; then
    rm -rf "$PII_TMPDIR"
  fi
}

# Strip comment lines, blank lines and CR bytes from a patterns file.
_pii_strip() {
  "$GREP" -vE '^[[:space:]]*(#|$)' "$1" 2>/dev/null | tr -d '\r'
}

# Split a patterns file into per-category temp files keyed on "# CATEGORY:"
# headers; pattern lines before any header land in the "misc" category.
_pii_split_categories() {
  tr -d '\r' < "$1" | awk -v out="$PII_TMPDIR" '
    /^[[:space:]]*#/ {
      h = $0
      if (sub(/^[[:space:]]*#[[:space:]]*CATEGORY:[[:space:]]*/, "", h) > 0) {
        gsub(/[^A-Za-z0-9_-]/, "_", h)
        if (h != "" && h != "_") cat = h
      }
      next
    }
    /^[[:space:]]*$/ { next }
    {
      if (cat == "") cat = "misc"
      # Append, not truncate: this function runs once per source file and a
      # category may exist in both the committed file and the overlay. The
      # tmpdir is fresh per run, so append yields exactly the union.
      print >> (out "/cat_" cat ".patterns")
      next
    }
  ' || return 1
}

# List the category names that have at least one pattern.
_pii_categories() {
  ( cd "$PII_TMPDIR" && ls cat_*.patterns 2>/dev/null ) | sed 's/^cat_//; s/[.]patterns$//'
}

pii_init() {
  GREP="${GREP:-grep}"

  if [ ! -f "$PII_PATTERNS_FILE" ]; then
    echo "PII guard internal error: $PII_PATTERNS_FILE not found" >&2
    exit 2
  fi

  PII_TMPDIR="$(mktemp -d 2>/dev/null)" || {
    echo "PII guard internal error: mktemp failed" >&2
    exit 2
  }
  trap pii_cleanup EXIT

  PII_MERGED="$PII_TMPDIR/merged.patterns"
  PII_FINDINGS="$PII_TMPDIR/findings.txt"
  : > "$PII_FINDINGS"

  _pii_strip "$PII_PATTERNS_FILE" > "$PII_MERGED"
  if [ -f "$PII_PATTERNS_LOCAL" ]; then
    # Private overlay is optional; missing overlay degrades silently.
    _pii_strip "$PII_PATTERNS_LOCAL" >> "$PII_MERGED"
  fi
  if [ ! -s "$PII_MERGED" ]; then
    echo "PII guard internal error: no usable patterns" >&2
    exit 2
  fi

  _pii_split_categories "$PII_PATTERNS_FILE" || {
    echo "PII guard internal error: category split failed" >&2
    exit 2
  }
  if [ -f "$PII_PATTERNS_LOCAL" ]; then
    _pii_split_categories "$PII_PATTERNS_LOCAL" || {
      echo "PII guard internal error: category split failed" >&2
      exit 2
    }
  fi
}

# _pii_grep_findings <label> <patterns-file> <category> <input-file>
# Appends "<label>:<lineno> [<category>]" lines to $PII_FINDINGS.
# Returns 0 = clean, 1 = findings; exits 2 on internal error.
_pii_grep_findings() {
  _pgf_label="$1"
  _pgf_pat="$2"
  _pgf_cat="$3"
  _pgf_input="$4"

  _pgf_out="$("$GREP" -inE -f "$_pgf_pat" "$_pgf_input" 2>/dev/null)"
  _pgf_rc=$?
  if [ "$_pgf_rc" -ge 2 ]; then
    echo "PII guard internal error: pattern scan failed" >&2
    exit 2
  fi
  if [ "$_pgf_rc" -eq 1 ]; then
    return 0
  fi
  printf '%s\n' "$_pgf_out" | while IFS= read -r _pgf_line; do
    _pgf_no="${_pgf_line%%:*}"
    printf '%s:%s [%s]\n' "$_pgf_label" "$_pgf_no" "$_pgf_cat" >> "$PII_FINDINGS"
  done
  return 1
}

# pii_scan_text <label> [category ...]
# Scans stdin. With category arguments only those categories are tested,
# otherwise every category. Findings are recorded as "<label>:<lineno>
# [<category>]". Returns 0 = clean, 1 = findings; exits 2 on internal error.
pii_scan_text() {
  if [ -z "$PII_TMPDIR" ] || [ -z "$PII_FINDINGS" ]; then
    echo "PII guard internal error: pii_init was not called" >&2
    exit 2
  fi
  _pt_label="$1"
  shift

  _pt_buf="$PII_TMPDIR/scan-text-input"
  cat > "$_pt_buf" || {
    echo "PII guard internal error: cannot buffer scan input" >&2
    exit 2
  }

  if [ "$#" -gt 0 ]; then
    _pt_cats="$*"
  else
    _pt_cats="$(_pii_categories)"
  fi

  _pt_found=0
  for _pt_cat in $_pt_cats; do
    _pt_pat="$PII_TMPDIR/cat_${_pt_cat}.patterns"
    [ -f "$_pt_pat" ] || continue
    if _pii_grep_findings "$_pt_label" "$_pt_pat" "$_pt_cat" "$_pt_buf"; then
      :
    else
      _pt_found=1
    fi
  done

  if [ "$_pt_found" -eq 1 ]; then
    return 1
  fi
  return 0
}

# pii_scan_annotated_stream
# stdin: a `git diff -U0` stream (plain diff or `git log -p`). Records
# "<path>:<line> [<category>]" findings for added lines only. Paths under
# .githooks/pii-patterns* are skipped. Returns 0 = clean, 1 = findings;
# exits 2 on internal error.
pii_scan_annotated_stream() {
  if [ -z "$PII_TMPDIR" ] || [ -z "$PII_FINDINGS" ]; then
    echo "PII guard internal error: pii_init was not called" >&2
    exit 2
  fi
  _as_ann="$PII_TMPDIR/annotated"

  # Annotate added lines as "<path>:<newline>:<added line content>".
  awk '
    BEGIN { path = ""; nline = 0; inhdr = 0; expectnew = 0; inbin = 0 }
    /^diff --git / { path = ""; nline = 0; inhdr = 1; expectnew = 0; inbin = 0; next }
    /^--- / {
      if (inhdr) expectnew = 1
      next
    }
    /^\+\+\+ / {
      if (inhdr && expectnew) {
        expectnew = 0
        path = ""
        if (substr($0, 5) != "/dev/null") {
          p = substr($0, 7)
          if (p !~ /^\.githooks\/pii-patterns/) path = p
        }
        next
      }
    }
    /^@@ / {
      inhdr = 0
      if (!inbin && path != "") {
        split($0, h, " ")
        r = h[3]
        sub(/^\+/, "", r)
        split(r, n, ",")
        nline = n[1] + 0
      }
      next
    }
    /^GIT binary patch$/ { inhdr = 0; inbin = 1; next }
    /^Binary files /     { inhdr = 0; inbin = 1; next }
    /^\+/ {
      if (!inbin && path != "" && nline > 0) print path ":" nline ":" substr($0, 2)
      nline++
      next
    }
    /^-/ { next }
    /^ / {
      if (!inbin) nline++
      next
    }
    { next }
  ' > "$_as_ann" || {
    echo "PII guard internal error: diff annotation failed" >&2
    exit 2
  }

  _as_found=0
  for _as_cat in $(_pii_categories); do
    _as_pat="$PII_TMPDIR/cat_${_as_cat}.patterns"
    [ -f "$_as_pat" ] || continue
    _as_out="$("$GREP" -inE -f "$_as_pat" "$_as_ann" 2>/dev/null)"
    _as_rc=$?
    if [ "$_as_rc" -ge 2 ]; then
      echo "PII guard internal error: pattern scan failed" >&2
      exit 2
    fi
    if [ "$_as_rc" -eq 0 ]; then
      printf '%s\n' "$_as_out" | while IFS= read -r _as_line; do
        _as_rest="${_as_line#*:}"        # drop the grep line number
        _as_path="${_as_rest%%:*}"
        _as_rest="${_as_rest#*:}"
        _as_no="${_as_rest%%:*}"
        printf '%s:%s [%s]\n' "$_as_path" "$_as_no" "$_as_cat" >> "$PII_FINDINGS"
      done
      _as_found=1
    fi
  done

  if [ "$_as_found" -eq 1 ]; then
    return 1
  fi
  return 0
}

# pii_report <hook-name>
# Prints the collected findings (one "<location> [<category>]" per line) plus
# the standard block message. Never echoes matched content.
pii_report() {
  _pr_hook="${1:-hook}"
  echo ""
  echo "PII guard: commit blocked by the $_pr_hook hook."
  if [ -s "$PII_FINDINGS" ]; then
    echo ""
    echo "Findings (location [category]):"
    sort -u "$PII_FINDINGS"
  fi
  echo ""
  echo "Patterns: .githooks/pii-patterns.txt (committed, generic shapes) plus"
  echo "the private per-clone overlay .githooks/pii-patterns.local.txt."
  echo "See README.md, section 'PII protection'. False positive? Tighten the"
  echo "pattern in your local overlay; never delete a category."
}
