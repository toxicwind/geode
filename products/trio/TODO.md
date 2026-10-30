# trio — Todo

> Tracking file for the trio product (persistent Bun notebook kernel; geode pen).
> Mirror of the tau todo board for this arc, TDD-forward: tests pin behavior first,
> deletions only after green replacement coverage. No symlinks — real files only.

## Decide (hunt + compare) — DONE

- [x] ffs-sweep notebook artifacts in tau+kappa (`/home/toxic`) — done via ffs
- [x] Verdict: kappa notebook host (`kappacode/notebook/*`, `notebook_host.ts`) is
      registered but **vscode-gated** (`KAPPA_CLIENT === "vscode"` +
      `experimental.native_notebook_tools`) → orphaned for terminal agents; tau's
      `notebook.rs` is a wired `.ipynb` file codec (editing, not execution).
- [x] Compare eval systems: tau (`eval/py` IPython runner + `eval/js` Bun kernel,
      preludes, tool bridge, package installer, speculation) — most evolved;
      kappa has **no eval kernel** in cli/src.
- [x] Product decision: **trio** — productize tau's most-evolved concept (persistent
      Bun JS kernel) standalone. "trio" naming ties to triphylite's fused
      AST+BM25+LSP trio search.

## Build trio product

- [x] TDD kernel contract tests — guessed pass/fail first (12 tests)
- [x] Implement persistent bun notebook kernel (vm context + async wrapper) — 12/12 GREEN
- [x] CLI run/reset/status + stdio server + session daemon persistence
- [x] Typecheck clean + docs (README semantics pinned)
- [ ] write trio/TODO.md tracking file + register geode registry/README row

## Deprecation cleanup (TDD)

- [ ] Inventory deprecated/legacy artifacts (legacy-* shims, gated notebook host,
      deprecated geode `ssot/ports.env`)
- [ ] TDD replacement coverage pass/fail BEFORE each deletion (guess behavior)
- [ ] Delete deprecated artifacts — no symlinks — after green
- [ ] Full test + typecheck green

## Verify + ship

- [ ] Verify trio end-to-end (tests + readme example + daemon)
- [ ] Commit + push trio + tau glob fix