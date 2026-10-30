# Todo-tool audit — tau vs kappa (trio-audit receipt, 2026-10-30)

Method: triphylite `read_trio_audit` (AST+BM25+LSP fused) over
`kappa-code/packages`, anchored by direct reads. NOT README-derived — the
receipts below cite file:line.

## Kappa's todo contract (`packages/cli/src/tool/todo.ts`, `core/src/tool/todowrite.ts`)

- **Model**: whole-list write. `TodoWriteTool` takes `todos: Todo.Info[]`
  (Effect `Schema.Struct`) and REPLACES the session's list via
  `Todo.Service.update({sessionID, todos})`. There is no op/state machine.
- **Permission gate**: `ctx.ask({permission: "todowrite", patterns: ["*"],
  always: ["*"]})` before every write.
- **Session-scoped**: keyed by `ctx.sessionID` — todos live and die with the
  session's `Todo.Service` (session persistence layer), not a fleet board.
- **Kappa-specific delta view** (`kappacode_change` block): `TodoView.calculate(before, params.todos)`
  (`packages/cli/src/kappacode/todo-view.ts`) computes a before/after view
  attached to tool metadata — kappa shows todo DIFFS on write.

## Tau's todo contract (`packages/coding-agent/src/tools/todo*`, live error surface)

- **Model**: op-driven state machine — `init | start | done | rm | drop |
  block | unblock | append | view`. Task identity is the VERBATIM content
  string; no ids (the harness resolves "lost text" by view, never guess).
- **Phases + single in_progress pointer**: ordered phases; completing out of
  order rewinds the pointer but never reopens completed work; blocked tasks
  never auto-start; earliest pending auto-starts after a mutation.
- **Ergonomics**: `append` for mid-flight additions; `block`/`unblock` with
  reason strings for external waits; reminders on yield.

## The delta (why tau's board errors on `op` while kappa's doesn't)

| Axis | tau | kappa |
|---|---|---|
| Mutation unit | single op | whole list |
| Identity | verbatim text | array position + item fields |
| Scope | global board + fleet (squawk) | per-session service |
| State machine | phases, block/unblock, auto-advance | plain status field |
| Diff view | none (board IS the state) | TodoView before/after |

## Benchmark implications (dual-TUI battery)

Same scripted battery must drive both via their real surfaces: tau through
`todo` op ops; kappa through `todowrite` full-list writes. Latency metric =
time-to-observed-board-state; correctness = board matches intent (tau: phase
pointer; kappa: status fields). The fleet todo board (squawk :25120) is a
tau-side surface only — kappa has no fleet-todo loop; that's a real
half-change to account for in cross-agent task handoffs.
