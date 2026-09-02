# U6 Full Harness Evidence Gates

## Work unit

- Branch: `test/m02-u6-gates`; delivery: feature-branch-chain / auto-chain.
- Receipt token: `sha256:771640eda07baae0de3224135c2f8e9ea33493ef28cb687a5457f239a9efdd33`.
- Failed evidence to remediate at later settlement: `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Scope: tasks 6.1–6.3 only; no Judgment Day, strict verify, archive, merge, commit, push, PR, or settlement.

## Requirement coverage (7/7)

| Requirement                        | Implementation authority                                                                                                    | Test authority                                                                                                             | Green command                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Compiler-coordinate observations   | `observeDiagnostic` in `src/services/diagnostics.ts` retains internal UTF-16 spans and projects only the public diagnostic. | `test/diagnostics.test.ts` — “observes compiler spans in JavaScript UTF-16 code units”                                     | Full chain: diagnostics 29/29; primary suite 963/963 |
| Bounded deterministic edit context | `buildEditContext` uses bounded deterministic mapping, cancellation checkpoints, and coarse fallback.                       | Mapping insertion/deletion/replacement/multiple-edit table, repeated-text tie-break, three cap cases, mapping cancellation | Full chain: diagnostics 29/29                        |
| Unchanged-run continuity           | `compareObservedDiagnostics` maps exact unchanged spans and performs stable FIFO matching.                                  | Disjoint repeated edits and duplicate FIFO tests; operation dual-purpose test excludes the shifted unrelated error         | Full chain: diagnostics 29/29; operations 36/36      |
| Touched spans fail closed          | Diagnostic/hunk boundary classification and affected-file missing-span handling in `src/services/diagnostics.ts`.           | Eight-case intersection/abutment/zero-width/missing-span table                                                             | Full chain: diagnostics 29/29                        |
| File and text edge cases           | Lifecycle partitions and compiler-text coordinates in `compareObservedDiagnostics`.                                         | Created/deleted/unchanged/unfiled lifecycle plus CRLF, surrogate, and BOM-excluded coordinate tests                        | Full chain: diagnostics 29/29                        |
| Corrected preparation authority    | `src/services/operations.ts` forms text changes before corrected delta, policy, v2 hash, and retention.                     | Same-identity default block, explicit allow, apply denial, and unchanged-disk assertions                                   | Full chain: operations 36/36                         |
| Cutover and external compatibility | Strict v1/v2 parsing in `operation-plan-file.ts`; v1 prepared denial and exact applied-v1 replay; guarded catalog.          | Persisted-plan 7/7 plus focused adapter/catalog 23/23 and pinned Harness smoke                                             | Full chain and focused Harness command both exit 0   |

## Scenario coverage (8/8)

| Scenario                         | Evidence                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Compatible observation           | Internal `start`/`length` are asserted while public values omit them.                                                              |
| Multi-edit bound                 | Ordered multi-edit runs, deterministic repeats, all three cap fallbacks, and typed cancellation pass.                              |
| Shifted duplicates               | FIFO duplicate matching and the unrelated shifted TS2322 continuity assertions pass.                                               |
| Boundary and missing-span matrix | All eight intersecting, abutting, zero-width, and missing-span cases add/remove conservatively.                                    |
| Lifecycle and coordinates        | Created/deleted/unchanged/unfiled cases and CRLF/surrogate/BOM-excluded offsets pass.                                              |
| Dual-purpose RED                 | Replacement TS2322 is the sole added error, preparation blocks, apply returns `MUTATION_BLOCKED`, and disk bytes remain unchanged. |
| Persisted states                 | New v2 envelope/hash/replay passes; v1 prepared is denied; exact applied-v1 replays; mismatched postimage is denied.               |
| Harness denial                   | Pinned revision exposes exactly 15 guarded tools, omits apply, and direct apply returns `UNKNOWN_TOOL`.                            |

## Gate results

| Gate                                                                                                                                                                                                        | Exact result                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env -u GIT_PAGER bash -lc 'yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build && yarn test:mcp && yarn test:lifecycle && yarn test:cli && yarn test:errors && yarn test:package'` | Exit 0. Format, lint, typecheck, and both builds passed. Vitest primary: 74 files, 963 tests passed; supervised: 1 file, 2 tests passed. MCP: status ok, 16 tools. Lifecycle: status ok, orphan processes 0. CLI, errors, and package smokes each returned status ok; package version 0.13.1 and 6 installed/idempotent targets. |
| `env -u GIT_PAGER bash -lc 'yarn vitest run test/dsh-adapter.test.ts test/tool-catalog.test.ts && yarn test:dsh-adapter'`                                                                                   | Exit 0. Focused Vitest: 2 files, 23 tests passed. Smoke phases a/b/c/h03/h05/d all ok; guarded catalogs 15→0→15; apply absent and direct call `UNKNOWN_TOOL`; cleanup ok.                                                                                                                                                        |

## Pinned Harness and cleanup proof

- Fresh smoke checkout authenticated HEAD `cd5ef8148158c3a752a658978873241fdf8e2bbc`, exact tag `dsh-v0.1.2-alpha.1`, CLI/MCP client `0.1.2-alpha.1`, CLI SHA-256 `dc23f6c5dd7df8834e3e38bdb9609d77b459834681ae9b7133b417b0c35f3166`, and native tools mode.
- The supplied Harness path is a metadata-free built checkout, so `git rev-parse HEAD` and `git status --short --branch` returned exit 128 both before and after. Read-only identity hashes were unchanged before/after: `package.json` `552fe076…34e2`, CLI `dc23f6c5…3166`, MCP package `9ab52348…a04`. No command wrote there.
- The smoke used its isolated fresh materialization, removed its temporary root, reported owned processes 0, H03 active/held/listeners/stale all 0, H05 active/held/listeners/timers/stale all 0, and `cleanup: "ok"`.

## TDD and rollback

Historical RED remains in apply-progress runs/evidence. Active RED is empty; the current U6 stage is GREEN/refactored because both exact gate chains pass under the single-variable environment sanitization.

| Work-unit evidence | Value                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Focused test       | Adapter/catalog command above: exit 0; 23/23.                                                                               |
| Runtime harness    | `yarn test:dsh-adapter` in the same command: exit 0; guarded-15, apply absent, direct `UNKNOWN_TOOL`, cleanup ok.           |
| Rollback boundary  | Revert only this evidence file and task/state/apply-progress 6.1–6.3 updates; U1–U5 implementation and tests remain intact. |
