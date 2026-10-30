# PI_CODING_AGENT_DIR relative-leak origin hunt (2026-10-30, WIP)

## Established ground truth (this session)
- Parent bash: NO var. tau process: `PI_CODING_AGENT_DIR=.tau/agent` (RELATIVE).
  => tau writes it into its OWN process.env post-launch (not inherited).
- dirs.ts 3 assignment sites: setAgentDir(dir) passes dir AS-GIVEN (relative
  possible); setProfile paths always absolute.
- env loader (packages/utils/src/env.ts): applies dotenv files into
  process.env — candidates: ~/.tau/.env (line 57 = ABSOLUTE, correct),
  ~/.tau/agent/.env (NVIDIA key only), cwd/.env* (none in ~/tmp),
  direnv (.envrc: tau/.envrc sources GHOST /home/toxic/estate/.envrc!).
- getConfigAgentDirName() returns RELATIVE ".tau/agent" BY DESIGN — some code
  path assigns its output to the env var; ast_grep found no `.ts` site (only
  prose hits in .sh bench files = false positives).

## Next (definitive, 5 minutes)
1. `TAU_LEGACY... ` no — instrument: run `tau -p ok` under `strace -f -e
   trace=write -s 200 2>&1 | grep PI_CODING` or set a getter trap
   (Object.defineProperty(process.env, 'PI_CODING_AGENT_DIR', {set})) in a
   preloaded module; the setter stack trace IS the leak site.
2. ALSO check: kappa-acp/kappa-serve.sh, estate-ops shims (they source
   .bashrc.env which is absolute — but a shim may re-export relative).

## Known escape
- forensia/cleavage/spine + (now) tau eval gates all reject relative —
  contained, not fixed at the source.
