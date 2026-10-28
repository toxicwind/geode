# Geode

One of the estate's five pens (`pens/{estate,geode,barn,ranch,olympus}`).
Every pen has the same shape: `products/` for peer standalone checkouts,
`docs/` for pen-owned documentation, and a `bin/` entrypoint surface that
is symlinked into `~/.local/bin` and pinned by the estate-ops manifest.

## Products

| Product | Port | Language | Role |
| --- | --- | --- | --- |
| chalcopyrite | 25200 | TypeScript | Ex-canonical router (renamed from the atlas lineage); retained, superseded by rhodochrosite :25193 |
| mimetite | — | TypeScript | Master provider catalog for the estate. One source of truth for every LLM |
| rhodochrosite | 25193 | Rust | **The canonical live router** — one OpenAI-compatible endpoint across all cloud providers; per-model breakers + provider concurrency gates |

## Facts (generated — do not hand-edit)

<!-- FACTS:START -->
| rhodochrosite port | 25193 (ports.env, canonical router) |
| gemini-mcp port | 25227 (ports.env GEMINI_MCP_PORT) |
<!-- FACTS:END -->

## Layout
```text
geode/
  .gitignore    kitchen-sink `*` + whitelist (submoduleless doctrine)
  README.md     this file — role, member table, ports, languages
  LICENSE
  package.json
  mise.toml
  AGENTS.md
  bin/          entrypoint symlink surface -> ~/.local/bin
  products/     peer standalone checkouts (auto-ignored, never tracked)
  docs/         pen-owned documentation
```

## Tooling

- **bin surface**: entrypoints symlinked into `~/.local/bin`, pinned by the
-  estate-ops manifest and verified by `bin-verify.sh`. A broken link is
-  a FAIL, never a WARN.
-  **README**: generated from the pen's own product set by
-  `bin/readme-gen.ts`.

## Conventions

- Submoduleless: peer repos are shallow clones, never git submodules
- Ports SSOT: `config/ports.env` is the single source of truth for :25xxx ports
- Bun runtime: all TS/JS products run on Bun; Go and Rust are compiled binaries

## License

Estate internal — all rights reserved.
