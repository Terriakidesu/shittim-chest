---
name: Ripgrep Search
description: Search repository files and code efficiently with ripgrep from the OpenCode CLI
---

# Ripgrep Search

Use this skill when locating files, symbols, strings, or related code in a
repository. Prefer focused searches over reading large files or running broad
recursive commands.

## Basic workflow

1. Identify the likely directory and file types.
2. Search filenames first when the path is unknown:

   ```sh
   rg --files -g '*.ts' -g '*.tsx'
   ```

3. Search contents with line numbers and a narrow include pattern:

   ```sh
   rg -n --glob '*.ts' 'functionName|className' src
   ```

4. Read the matching file around the reported lines before editing.
5. Re-run the focused search after changes to confirm references and stale code
   are handled.

## Search patterns

- Use fixed-string mode for literal text: `rg -n -F 'exact text' path`.
- Use regular expressions for alternatives or boundaries:
  `rg -n '\b(foo|bar)\b' path`.
- List matching files only with `rg -l 'pattern' path`.
- Show context with `rg -n -C 3 'pattern' path`.
- Search filenames with `rg --files | rg 'component|test'`.
- Search hidden project files only when needed: `rg --hidden ...`.
- Use `-uuu` only for an intentional all-files search; it can include ignored,
  binary, and hidden files and may be very noisy.
- Exclude generated or dependency directories explicitly when needed:
  `rg -n 'pattern' -g '!node_modules/**' -g '!dist/**' .`.

## Shell portability

The OpenCode CLI may run in PowerShell on Windows or a POSIX shell elsewhere.
Quote patterns and paths, use forward slashes where accepted, and avoid shell
features that are not portable. In PowerShell, prefer single quotes around
regular expressions so `$` and backticks are not expanded.

Do not use a leading slash in repository paths unless an absolute path is
required. Start from the current working directory or pass a specific relative
directory to keep searches scoped.

## Good search hygiene

- Start narrow, then widen the path or glob only if necessary.
- Search for the exact symbol, route, error text, or data key before guessing
  filenames.
- Inspect both definitions and call sites.
- Treat matches in generated output, dependencies, vendored code, and build
  artifacts as lower priority unless the task specifically concerns them.
- Do not modify, delete, or overwrite files as part of a search.
- If a search returns no matches, check spelling, case sensitivity, file globs,
  ignored files, and the current working directory before concluding that the
  code is absent.

## Useful recipes

```sh
# Find likely implementation and test files
rg --files | rg '(src|test|tests)/.*(router|route|api)'

# Find imports and usages of a symbol
rg -n --glob '*.{ts,tsx,js,jsx}' '\bSomeSymbol\b' .

# Find TODOs outside generated files
rg -n 'TODO|FIXME' -g '!node_modules/**' -g '!dist/**' .

# Inspect a JSON key without matching similarly named keys
rg -n '"schemaVersion"\s*:' --glob '*.json' .
```
