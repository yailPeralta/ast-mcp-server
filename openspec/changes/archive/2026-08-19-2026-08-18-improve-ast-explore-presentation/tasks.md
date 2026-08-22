# Tasks: Improve `ast_explore` Presentation

## Historical PR1–PR3 (complete)

Original forecast: 850–1,150 lines, high risk, `ask-on-risk`, feature-branch-chain; bases were feature/tracker→PR1→PR2a→PR2b; all four units remain complete. Evidence/rollback: PR1 `yarn test test/relationships.test.ts test/call-spines.test.ts` → revert relationships/call-spines and tests; PR2a `yarn test test/explore-presentation.test.ts test/context-builder.test.ts` → revert presenter/context and tests; PR2b `yarn test test/explore.test.ts -t "publishes additive call-spine and omission controls without changing defaults" && yarn test test/mcp.integration.test.ts -t "exposes exact compiler call spines and bounded omission metadata"` → revert explore wiring/tests; PR3 `yarn test test/mcp.integration.test.ts -t "keeps ast_explore direct, batch, JSON, and TOON results logically equivalent" && yarn test test/mcp.integration.test.ts -t "cancels queued ast_explore work without returning partial evidence"`; harness `yarn test:mcp && yarn test:cli`; revert batch/benchmark/docs/skill only.

## Phase 1: Exact Call-Spine Foundation (complete)

- [x] 1.1 RED: call classification, bounded canonical traversal, empty authority in `test/relationships.test.ts`, `test/call-spines.test.ts`.
- [x] 1.2 GREEN: projection/BFS in `src/services/relationships.ts`, `src/services/call-spines.ts`.
- [x] 1.3 REFACTOR: preserve ordering/bounds; rerun service/compiler evidence.

## Phase 2: Atomic Presentation Core (complete)

- [x] 2.1 RED: stable page, oversized symbol, defaults, budget, incomplete, untrusted negative control.
- [x] 2.2 GREEN: presenter/context fixed-point bytes, whole clusters, selector progress, omissions/completeness; no public wiring.
- [x] 2.3 REFACTOR: preserve ranking/no-call defaults; run PR2a command.

## Phase 3: Public Contract (complete)

- [x] 3.1 RED: additive exact-symbol `call_spines`/omission schemas and compatibility.
- [x] 3.2 GREEN: wire `src/tools/explore.ts` and orchestration.
- [x] 3.3 REFACTOR: focused pair plus registered-handler harness.

## Phase 4: Batch, Evidence, Release (complete)

- [x] 4.1 RED: equivalent execution, root/bound failure, JSON/TOON serialization, cancellation, root conflict.
- [x] 4.2 GREEN: admit `ast_explore` in `src/batch/schema.ts`; benchmark cases and runner/CLI.
- [x] 4.3 REFACTOR/GATES: ADR/README/CHANGELOG/skill; format, lint, typecheck, tests, build, smokes.

## Phase 5: Deterministic benchmark remediation (complete; one PR3 work unit)

- [x] 5.1 **RED/Strict TDD:** `test/benchmark-agent-workflows.test.ts` proves deterministic bytes/no volatile keys; differing observation bytes; identical second publication preserves tracked bytes+mtime; each false gate (`evidence_preserved`, `call_bounds_respected`, `impact_corpus_pass`, `impact_no_heuristic_authority`, `impact_negative_controls_pass`, `impact_candidate_fail_closed`) preserves last-known-good tracked evidence and records volatile failure; rejects relative/absolute, symlink-parent, and hard-link aliases. Cover every applicable design threat case before production.
- [x] 5.2 **GREEN:** `scripts/benchmark-agent-workflows.mjs` gets import-safe exports/main guard, allowlisted deterministic schema v4, volatile schema v1, `--observations-output`, gate-before-write, in-memory formatting, exact-byte conditional writes, path/file-identity revalidation, argv-safe subprocesses, stable ordering.
- [x] 5.3 **REFACTOR/docs/evidence:** update `.gitignore`; regenerate tracked artifact; run `yarn format:check`, `yarn lint`, `yarn typecheck`, full `yarn test`, focused `yarn test test/benchmark-agent-workflows.test.ts`, then twice run `yarn build && node scripts/benchmark-agent-workflows.mjs --output benchmark/results/self-agent-workflows.json --observations-output benchmark/results/runtime/self-agent-workflows.json`; prove hash/mode/mtime no-op, six gates, and bounded cumulative apply-progress mirrors. Rollback only remediation test/script/ignore/tracked artifact.

## Remediation forecast

Estimated changed lines: 240–330; one autonomous PR3 unit, below 400.
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: feature-branch-chain
400-line budget risk: Low

Totals: 15 tasks; 15 complete, 0 pending. Mirror both this file and Engram topic `sdd/2026-08-18-improve-ast-explore-presentation/tasks` (#1061). Canonical Markdown: LF; raw terminal-whitespace delta: one filesystem LF removed by Engram TrimSpace; canonical equality after trimming: true.
