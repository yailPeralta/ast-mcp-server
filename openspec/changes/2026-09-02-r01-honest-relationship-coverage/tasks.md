# Tasks: Honest Relationship Coverage

## Review Workload Forecast

Planning artifacts are excluded from implementation estimates. Forecast: **2,015–2,570 authored changed lines**; every proposed unit is ≤400 lines and ≈≤60 review minutes.

<!-- prettier-ignore -->
| Field                            | Value                                   |
| -------------------------------- | --------------------------------------- |
| Estimated authored changed lines | 2,015–2,570 additions + deletions       |
| 400-line budget risk             | High                                    |
| Chained PRs recommended          | Yes                                     |
| Suggested split                  | U1 → U2 → U3 → U4 → U5 → U6 → U7 → U8   |
| Delivery strategy                | feature-branch-chain                    |
| Chain strategy                   | selected and authorized                 |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

**Human decision recorded:** `feature-branch-chain` was explicitly selected after the High-risk forecast. Create a draft tracker, target U1 at the tracker branch, and target every later unit at its immediate predecessor. Keep every authored review unit within 400 changed lines.

## Receipt, TDD, and Authority Contract

Launch U1–U7 sequentially through dedicated foreground `sdd-apply` executors. Each unit acquires its own runtime receipt before any edit/check and runs only on `proceed`:

```bash
~/.local/bin/gentle-ai sdd-attempt acquire --cwd "$PWD" --change 2026-09-02-r01-honest-relationship-coverage --request-id r01-uN-a1-acquire --work-unit "UN" --evidence-goal "<unit acceptance IDs>" --max-attempts 2 --max-changed-lines 400
~/.local/bin/gentle-ai sdd-attempt settle --cwd "$PWD" --change 2026-09-02-r01-honest-relationship-coverage --token "$TOKEN" --request-id r01-uN-a1-settle --outcome <passed|failed|interrupted> --evidence-revision sha256:<exact-path-sorted-manifest-hash> --diagnosis "<exact result>" --harness-disposition <reused|invalidated> --cleanup-evidence "<fixtures/temp/generated/worktree cleanup>" --process-evidence "<owned process exit/no survivors>"
```

For U1–U7, replace `N` with 1–7; retry family `a2` never reuses a token, request ID, revision, or continuation. U8 is not one reusable authority: launch Judgment Day and strict `sdd-verify` as separate dedicated foreground phases, acquiring/settling `r01-u8-judgment-aM-*` and `r01-u8-verify-aM-*` respectively. Judgment fixes use `r01-u8-judgment-rK-aM-*` and start with a focused RED. Settle each phase before launching the next. A Judgment runtime receipt records only that launch and cannot authorize verify; its verdict grants no delivery authority. A verify receipt cannot authorize archive or delivery. `sdd-archive` is a dedicated foreground, non-runtime phase; if post-verify runtime work is explicitly required, reacquire `r01-u8-final-runtime-aM-*` and still obtain separate delivery authority.

Hash all authored files plus generated evidence in a path-sorted SHA-256 manifest. The sole persistent progress journal and dock source is `openspec/changes/2026-09-02-r01-honest-relationship-coverage/apply-progress.json`, never Markdown. Atomically rewrite parseable JSON after every task or RED → GREEN → REFACTOR transition with schema `dsh-sdd-apply-progress`, the exact change name, task `id`/`name`/`status`, three `tdd` arrays, and `updatedAt`. Keep stable active IDs (for example `u1-exact-edge`) in exactly one of `red`, `green`, or `refactored`; at U2 settlement that ID remains in `red` while U2 ledger IDs may be `refactored`, then U3 moves it to `green` and `refactored`. Journal acquire/settle, commands, exact results, revision, cleanup, and process evidence as valid JSON updates, never appended prose.

All behavior units add tests before production where feasible and execute RED → GREEN → REFACTOR. Documentation, snapshots, compatibility fixtures, or weakened assertions MUST NOT mask a behavioral RED. No unit may merge or retain tests/schema/docs that claim completeness without its producer, ledger, shared budget, and fail-closed consumer gate; rollback the entire listed boundary instead.

## Suggested Work Units

| Unit; forecast; dependency                                  | Exact likely files                                                                                                                                                                     | Focused RED → GREEN; refactor check                                                                                                                                                                                  | Rollback / no-partial-authority boundary                                                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1 MCP defect RED; 45–70; approved #161                     | `test/mcp.integration.test.ts`, `apply-progress.json`                                                                                                                                  | `env -u GIT_PAGER yarn vitest run test/mcp.integration.test.ts -t "rejects false-complete incoming call emptiness"` must fail for empty/non-incomplete; rerun unchanged to preserve intended RED; `git diff --check` | Revert only test/evidence; no production edit or compatibility fixture may make RED pass.                                                               |
| U2 ledger/registry/shared budget; 330–400; U1               | `src/services/{relationships,impact,read-contracts}.ts`, `test/impact.test.ts`, U1 test                                                                                                | `env -u GIT_PAGER yarn vitest run test/impact.test.ts -t "coverage"` RED then GREEN; rerun plus U1; simplify only after GREEN                                                                                        | Revert types, total registry, tracker, ledger, tests together; absent keys remain unsupported, never complete.                                          |
| U3 exact scoped calls; 340–400; U2                          | `src/services/relationships.ts`, `test/{impact,relationships,call-spines}.test.ts`                                                                                                     | `env -u GIT_PAGER yarn vitest run test/impact.test.ts test/relationships.test.ts test/call-spines.test.ts -t "call"` RED/GREEN/refactor rerun                                                                        | Revert classifier and scoped producer with tests; never adapt the global collector per BFS node or guess targets.                                       |
| U4 direct contains; 300–380; U3                             | `src/services/{relationships,impact}.ts`, `test/impact.test.ts`                                                                                                                        | `env -u GIT_PAGER yarn vitest run test/impact.test.ts -t "contain"` RED/GREEN/refactor rerun                                                                                                                         | Revert contains registry/producer/tests together; no syntax/index/runtime/transitive ownership authority.                                               |
| U5 public impact + candidates; 320–400; U4                  | `src/tools/{relationship-schema,get_impact,find_test_candidates}.ts`, `src/services/test-candidates.ts`, `test/{mcp.integration,test-candidates,batch}.test.ts`                        | `env -u GIT_PAGER yarn vitest run test/mcp.integration.test.ts test/test-candidates.test.ts test/batch.test.ts -t "candidate"` RED/GREEN/refactor rerun                                                              | Revert schema/projection/six-kind gate/tests atomically; never allow `proven_empty` from unsafe coverage.                                               |
| U6 seven-kind/mixed/bounds/cancellation matrix; 320–400; U5 | `test/{mcp.integration,impact,relationships,test-candidates,batch}.test.ts`, narrowly required U2–U5 runtime files                                                                     | `env -u GIT_PAGER yarn vitest run test/mcp.integration.test.ts test/impact.test.ts test/relationships.test.ts test/test-candidates.test.ts test/batch.test.ts` RED/GREEN/refactor rerun                              | Revert each regression with its narrow remediation; never weaken matrix expectations, bounds, or typed cancellation.                                    |
| U7 docs/full/package/Harness evidence; 180–260; U6          | `README.md`, `docs/adr/{0007-compiler-first-impact-relationships,0012-public-affected-test-candidates}.md`, `docs/ast-mcp-server-harness-improvement-report.md`, `apply-progress.json` | RED N/A after behavioral GREEN; run clean gates below; refactor docs then `format:check`/`git diff --check`                                                                                                          | Revert docs/evidence as one cutover; docs cannot substitute for runtime proof; no Harness checkout edit.                                                |
| U8 Judgment/strict verify/archive/delivery; 180–260; U7     | change `judgment-day.json`, `verify-report.md`, `archive-report.md`, `state.yaml`, `tasks.md`, `apply-progress.json`; immutable archive destination                                    | RED only for confirmed Judgment defect; remediation GREEN + re-judgment; validator/archive checks below                                                                                                              | Revert unarchived closure artifacts together; never archive/merge with open severe findings, failed validator, unsettled receipt, or partial authority. |

**Parallelism:** implementation is intentionally linear because U2–U6 share authority-bearing services and each consumes the prior contract. After U6 GREEN, independent clean commands may run concurrently only if one U7 receipt owns the exact common revision and every process is settled; Judgment, strict verify, archive, and delivery remain ordered.

## Phase 1 — U1 Registered MCP False-Complete RED

- [x] **1.1 [U1 RED; HRC-R4-S1, HRC-R11-S1]** Acquire `r01-u1-a1-acquire`; in `test/mcp.integration.test.ts` add the smallest registered `ast_get_impact` incoming-`call` fixture for `result → formatValue`, asserting the exact final edge/coverage and forbidding `edges: []` with `incomplete: false`.
- [x] **1.2 [U1 RED proof]** Run the U1 command before any production edit; record the assertion diff showing the current missing scoped producer—not selector, freshness, serialization, or fixture setup—is the failure.
- [x] **1.3 [U1 hold/refactor]** Make no production change, run `env -u GIT_PAGER git diff --check`, settle `r01-u1-a1-settle` as expected failed evidence, and preserve this RED as U2/U3’s predecessor.

## Phase 2 — U2 Coverage Types, Total Registry, Shared Operation Budget

- [x] **2.1 [U2 RED; HRC-R1-S1, R2-S1, R3-S1, R7-S1]** Acquire receipt; add service tests for all normalized kind×direction×endpoint-class keys, canonical order, precedence, safe empty, missing producer, mixed statuses, monotonic one-request work, exact exhaustion, and legacy-array graph parity.
- [x] **2.2 [U2 GREEN]** Add frozen coverage/work types, a total producer/N/A/unsupported registry, `CompilerImpactResult`, one request-private tracker/ledger, `work_limit`, and incomplete aggregation in listed service files; make U1 fail closed until U3 supplies the exact call edge.
- [x] **2.3 [U2 REFACTOR]** Remove test-only missing-producer seams and per-`edgesFor` budget resets; preserve ≤28 ordered entries, status precedence, `consumed_items <= max_items`, legacy `traverseImpact`, checkpoints, and existing truncation order.
- [x] **2.4 [U2 evidence]** Run U2 plus U1 commands, diff check, cleanup/hash, and settle U2 as passing only its ledger acceptance; preserve `u1-exact-edge` as the intentional active RED until U3 and do not claim overall GREEN.

## Phase 3 — U3 Scoped Exact Call Producer

- [x] **3.1 [U3 RED; HRC-R4-S1/S2]** Acquire receipt; add tests first for incoming/outgoing free functions, methods, constructors, overload normalization, repeated sites, body ownership, stable scans, and ambiguous/dynamic/unresolved unfinished poisoning.
- [x] **3.2 [U3 GREEN]** Extract pure shared invocation classification, implement local-body outgoing and normalized-path incoming scoped scans under the U2 tracker, and emit only exact canonical caller→callee edges; make U1 GREEN.
- [ ] **3.3 [U3 REFACTOR]** Deduplicate global/scoped classification without cross-endpoint caches; rerun U3/U1, prove global call-spine discovery unchanged, cleanup/hash, and settle U3.

## Phase 4 — U4 Scoped Direct Contains Producer

- [ ] **4.1 [U4 RED; HRC-R5-S1, R6-S1]** Acquire receipt; add module→top-level, symbol→direct named child, inverse incoming, module-incoming N/A, constructors/members, stable ordering, completed-empty, and all exclusion cases before code.
- [ ] **4.2 [U4 GREEN]** Implement canonical direct named ownership with existing endpoint/edge constructors and the shared tracker; exclude statements, imports/exports, parameters, anonymous/transitive/runtime/heuristic/index ownership.
- [ ] **4.3 [U4 REFACTOR]** Centralize nearest-owner/direct-child logic after GREEN; rerun U4 plus ledger tests, cleanup/hash, and settle U4 with the whole producer boundary reversible.

## Phase 5 — U5 Public Schema, Impact, and Six-Kind Candidate Contract

- [ ] **5.1 [U5 RED; HRC-R3-S1, R10-S1; ATC-R1-S1, R2-S2/S3]** Acquire receipt; test additive ordered `coverage`/`work`, logical JSON/TOON equality, unchanged public fields/errors, exact frozen incoming six-kind candidate request excluding `contains`, unsafe-coverage rejection, and authoritative proven-empty.
- [ ] **5.2 [U5 GREEN]** Add bounded Zod schemas/projection; make candidates explicitly pass `reference/import/export/extends/implements/call`, gate before projection/pagination, and preserve `INCOMPLETE_EVIDENCE`, T-01 paths, pagination, correlation, and MCP/batch implementation identity.
- [ ] **5.3 [U5 REFACTOR]** Remove implicit default-all candidate paths/duplicate safety checks; rerun focused MCP/candidate/batch tests plus schema snapshots, cleanup/hash, and settle U5 without exact-shape fixtures masking behavior.

## Phase 6 — U6 Seven-Kind, Mixed, Bounds, and Cancellation Matrix

- [ ] **6.1 [U6 RED; HRC-R2-S1, R7-S1, R8-S1, R9-S1; ATC-R2-S1]** Acquire receipt; add one compiler-backed registered-MCP positive/completed-negative matrix for seven kinds, applicable directions/classes, reordered declarations/IDs, mixed kinds, exact depth/node/edge/work boundaries, and mid-scan abort.
- [ ] **6.2 [U6 GREEN]** Apply only narrow runtime corrections exposed by those REDs; require deterministic `work_limit`, unfinished coverage, candidate `INCOMPLETE_EVIDENCE`, and typed `REQUEST_CANCELLED` with no partial success payload.
- [ ] **6.3 [U6 REFACTOR]** Consolidate fixture builders/table cases after GREEN; rerun U1–U6 focused commands, prove all 17 scenarios represented without weakened assertions, cleanup/hash, and settle U6.

## Phase 7 — U7 Documentation, Clean Gates, Package, and Pinned Harness

- [ ] **7.1 [U7 docs; HRC-R10-S1, ATC-R1-S1]** Acquire receipt; document additive ledger/work, direct contains, conservative calls, six-kind candidates, cutover/rollback, and R-01 closure only after U6 behavioral GREEN.
- [ ] **7.2 [U7 full clean gate]** Run only required sanitation: `env -u GIT_PAGER bash -lc 'yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build && yarn test:mcp && yarn test:lifecycle && yarn test:cli && yarn test:errors && yarn test:package'`.
- [ ] **7.3 [U7 Harness; HRC-R11-S2]** Snapshot status of pinned checkout `/home/yail/.local/share/dsh-oauth-cutover/cd5ef8148158c3a752a658978873241fdf8e2bbc/host`; run `env -u GIT_PAGER bash -lc 'yarn vitest run test/dsh-adapter.test.ts test/tool-catalog.test.ts && yarn test:dsh-adapter'`; prove package identity revision `cd5ef814…`, exactly 15 guarded AST tools, catalog excludes apply, direct apply is `UNKNOWN_TOOL`, and before/after Harness status is identical with **no Harness edits**.
- [ ] **7.4 [U7 settle]** Run `env -u GIT_PAGER git diff --check`, record full/package/Harness command outputs and process/temp cleanup, exact evidence revision, settle U7, and reject any stale or partially passing continuation.

## Phase 8 — U8 Judgment Day, Strict Verify, Immutable Archive, Delivery

- [ ] **8.1 [U8 Judgment launch]** In its dedicated foreground phase, acquire `r01-u8-judgment-a1-acquire`, freeze the exact U7 revision, and run blind dual Judgment Day. Require `APPROVED`; confirmed-finding rounds use their own `r01-u8-judgment-rK-a1-*` receipt, focused RED, GREEN, and blind re-judgment. Settle `r01-u8-judgment-a1-settle` before verify; suspects alone do not authorize edits.
- [ ] **8.2 [U8 strict verify launch]** Separately acquire `r01-u8-verify-a1-acquire` and launch the dedicated foreground `sdd-verify` executor against the Judgment-approved revision. Build `verify-report.md` for exactly 13 requirements/17 scenarios; run `~/.local/bin/gentle-ai sdd-verify-validate --input openspec/changes/2026-09-02-r01-honest-relationship-coverage/verify-report.md --requirements 13 --scenarios 17`; persist only admitted exact bytes.
- [ ] **8.3 [U8 verify settle]** Under only the verify token, re-run strict clean, package, Harness, diff, cleanup/process, task, and ≤400-per-unit evidence checks on one immutable candidate; settle `r01-u8-verify-a1-settle` at its exact revision. Its receipt ends verify authority and cannot authorize archive or delivery.
- [ ] **8.4 [U8 archive]** With only 8.4/8.5 allowed pending after strict verify, launch dedicated foreground `sdd-archive`; merge deltas after validator PASS, mark 8.4 before freezing, then snapshot and mechanically move the complete change to `openspec/changes/archive/<archive-date>-2026-09-02-r01-honest-relationship-coverage/`. Verify active absence, immutable bytes, 13/17 trace, receipts, Judgment, and reports; run no runtime gate unless separately reacquired; never edit legacy `openspec/archive/`.
- [ ] **8.5 [U8 delivery closure]** This may remain unchecked in the immutable archive. After the human-selected strategy, GREEN CI, archive proof, and separate delivery authority, merge children in order and close approved issue #161/chosen tracker through external merge evidence; never edit archived bytes to backfill delivery, mutate issues/PRs during planning, or merge with an open child/partial authority.

## Requirement / Scenario Trace

| Acceptance ID   | Scenario                                                                     | Units      |
| --------------- | ---------------------------------------------------------------------------- | ---------- |
| HRC-R1-S1       | Report combinations — Explicit keys                                          | U2, U6     |
| HRC-R2-S1       | Order deterministically — Stable projects                                    | U2, U6     |
| HRC-R3-S1       | Authorize completeness — Mixed kinds fail closed                             | U2, U5, U6 |
| HRC-R4-S1/S2    | Resolve exact calls — Exact calls; Inexact calls                             | U1, U3     |
| HRC-R5-S1       | Expose direct containment — Direct containment                               | U4         |
| HRC-R6-S1       | Exclude false containment — Exclusions                                       | U4         |
| HRC-R7-S1       | Bound request work — Exhaustion                                              | U2, U6     |
| HRC-R8-S1       | Cancel without partial success — Cancellation                                | U6         |
| HRC-R9-S1       | Prove seven kinds — Seven-kind matrix                                        | U6         |
| HRC-R10-S1      | Preserve compatibility — No upgrade                                          | U5, U7     |
| HRC-R11-S1/S2   | Preserve public boundaries — MCP false-complete rejection; Harness read-only | U1, U7     |
| ATC-R1-S1       | Traverse incoming relationships — Incoming authoritative six-kind set        | U5, U7     |
| ATC-R2-S1/S2/S3 | Fail closed — Partial; unsupported/unfinished; proven empty                  | U5, U6     |

Design stages map exactly: **1→U1, 2→U2, 3→U3, 4→U4, 5→U6, 6→U5, 7→U6, 8→U5, 9→U7–U8**. Total: **8 units, 28 checkbox tasks, 13 requirements, 17 scenarios**.

## Completion Definition

The plan contains 28 tasks across 8 units. U1–U7 each finish within ≤400 authored lines and their own settled runtime receipt; U2 may pass only its ledger acceptance while U1’s exact-edge RED remains active until U3, so overall GREEN begins only after U3. U1–U6 end GREEN/refactored; all 13/17 acceptance IDs and clean/full/package/Harness gates pass with no Harness delta. Judgment is `APPROVED` under its settled launch, then strict verify independently admits and settles the exact candidate. The workflow exception permits strict verify to finish with only archive 8.4 and delivery 8.5 pending; archive marks 8.4 before freezing and may preserve 8.5 unchecked permanently. Later delivery is proven by external merge/issue evidence, never by editing immutable archive bytes. Any unsupported/unfinished/exhausted/cancelled path remains fail closed and can never authorize complete emptiness or candidate `proven_empty`.
