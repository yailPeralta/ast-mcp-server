# Tasks: Preserve Computed-Key Call Uncertainty

## Review Workload Forecast

| Field                            | Value                                                             |
| -------------------------------- | ----------------------------------------------------------------- |
| Estimated authored changed lines | U1: 300–390 additions + deletions                                 |
| Delivery strategy                | auto-chain                                                        |
| Chain strategy                   | feature-branch-chain (one runtime child)                          |
| Suggested split                  | Planning baseline → U1 runtime child; no artificial runtime split |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: feature-branch-chain
400-line budget risk: Medium

Merged prerequisite #247 is required. Issue #220 and all Harness/apply behavior are excluded; this change is independent of #186, #188, and F-01.

## U1 File and Review Boundary

| File / symbol scope                                                                                                                                                                |       + |      - |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------: | -----: |
| `src/services/relationships.ts`: `scopedDirectCallTarget`, incoming/outgoing call producers, resolver, whole-project collector, new request-local computed-call classifier/catalog |      90 |     20 |
| `src/services/context-builder.ts`: `buildExploreContext` gap projection                                                                                                            |       8 |      2 |
| `src/services/call-spines.ts`: `CallSpineOptions`, `planCallSpines` relevant-gap authority                                                                                         |      20 |      4 |
| `test/relationships.test.ts`: whole-project classifier cases                                                                                                                       |      28 |      2 |
| `test/impact.test.ts`: scoped incoming/outgoing, mixed, bounds/order, #220 controls                                                                                                |      70 |      4 |
| `test/call-spines.test.ts`: relevant-gap planner cases                                                                                                                             |      25 |      2 |
| `test/mcp.integration.test.ts`: impact/spines/candidates, MCP/batch JSON/TOON parity                                                                                               |      70 |      4 |
| Apply evidence updates in `tasks.md`, `chain.md`, `apply-progress.json`, `state.yaml`                                                                                              |      24 |     12 |
| **Forecast**                                                                                                                                                                       | **335** | **50** |

No edits are expected in `src/services/impact.ts`, `src/tools/get_impact.ts`, `src/tools/find_test_candidates.ts`, `src/services/test-candidates.ts`, or `test/test-candidates.test.ts`; their existing completeness gates are verification scope. Hard stop at 400 authored additions + deletions.

## Phase 0: Apply Admission and Baseline

- [x] 0.1 **[R1,R2,R3; S1–S19; D1–D3]** Confirm #247 remains merged, source/test edit authority is granted, the child base is the frozen `docs/219-design` planning baseline, and exclusions remain untouched; do not inherit historical Judgment/receipt authority.
- [x] 0.2 **[R1,R2,R3; S1,S6–S10,S14–S16,S18–S19; D1,D3]** Run `yarn vitest run test/relationships.test.ts test/impact.test.ts test/call-spines.test.ts test/mcp.integration.test.ts test/test-candidates.test.ts test/batch.test.ts --no-file-parallelism`; expect exit 0 and record the exact baseline count/output hash.

## Phase 1: Strict RED → GREEN

- [x] 1.1 **[R1,R2,R3; S2–S5,S11–S13,S17–S19; D1–D3]** Acquire request ID `issue219-u1-apply-v1`; add only tests named `computed-key call authority` in the four forecast test files. Run `yarn vitest run test/relationships.test.ts test/impact.test.ts test/call-spines.test.ts test/mcp.integration.test.ts -t "computed-key call authority" --no-file-parallelism --reporter=dot` twice unchanged; both runs must exit 1 with identical failing-test names/fingerprint because one selected union alternative still yields guessed/completed authority. Any pass, drift, flaky/infrastructure, or unrelated failure stops U1.
- [x] 1.2 **[R1; S1–S7; D1–D3]** Minimally implement one bounded compiler-derived `ComputedCallAuthority` classifier and lazy request-local catalog in `relationships.ts`: enumerate key × receiver alternatives, allow one literal only into existing checks, emit no guessed edge, and mark relevant incoming/outgoing cells unfinished for any gap.
- [x] 1.3 **[R2; S8–S13; D1–D3]** Minimally propagate bounded relevant gaps through `collectCompilerCallRelationships` → `buildExploreContext` → `planCallSpines`; retain independent exact paths but force incomplete/non-authoritative and `empty_proven: false` for affected directions.
- [x] 1.4 **[R3; S14–S19; D1–D3]** Re-run the unchanged RED command; expect exit 0 for every selected test and verify public candidate calls return stable `INCOMPLETE_EVIDENCE` before pagination with no candidate page.

## Phase 2: Refactor, Compatibility, and Evidence

- [x] 2.1 **[R1,R2,R3; S1–S19; D1–D3]** Refactor only duplicate enumeration/catalog code while preserving `O(N·K·R)` bounded work, canonical key/selector ordering, relationship-ID ordering, freshness, and separate semantic versus truncation/work evidence; rerun the focused command after each edit, expecting exit 0.
- [x] 2.2 **[R1,R2,R3; S1–S19; D1–D3]** Run `yarn vitest run test/relationships.test.ts test/impact.test.ts test/call-spines.test.ts test/mcp.integration.test.ts test/test-candidates.test.ts test/batch.test.ts --no-file-parallelism`; expect exit 0. Then run `yarn test:mcp && yarn test:cli`; expect both built-artifact smokes to pass with MCP/batch and JSON/TOON logical parity.
- [x] 2.3 **[R1,R2,R3; S1–S19; D1–D3]** Run `yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build`; expect exit 0 throughout. Benchmark is compatibility-relevant, not a performance claim: run `yarn benchmark:agent-workflows`, expect all existing impact gates pass unchanged; no new benchmark artifact is required.
- [ ] 2.4 **[R1,R2,R3; S1–S19; D1–D3]** Capture RED×2 fingerprints, GREEN/refactor results, paths, authored line count ≤400, output hashes, runtime evidence, candidate identity, and rollback in progress artifacts; settle only with request ID `issue219-u1-settle-v1`. Never publish a failing-test-only child.

## Phase 3: Review, Verify, CI, Archive

- [x] 3.1 **[R1,R2,R3; S1–S19; D1–D3]** Freeze the complete U1 candidate and run two independent blind Judgment reviewers with identical scope; merge findings, allow at most two explicitly authorized correction/re-judgment rounds, and require both final judgments to approve the same candidate.
- [ ] 3.2 **[R1,R2,R3; S1–S19; D1–D3]** On the approved immutable candidate, create the verify report and run `/home/yail/.local/bin/gentle-ai sdd-verify-validate --input openspec/changes/2026-09-06-issue-219-computed-key-call-authority/verify-report.md --requirements 3 --scenarios 19`; expect exit 0 with 3/3 requirements and 19/19 scenarios admitted.
- [ ] 3.3 **[R1,R2,R3; S1–S19; D1–D3]** Require newest exact-head CI success on Node `22.13.0` and `24` for `.github/workflows/ci.yml`, including immutable install, format, lint, typecheck, test/build, MCP/errors/lifecycle/CLI/package/adapter smokes, audit, pack, policy, and diff check.
- [ ] 3.4 **[R1,R2,R3; S1–S19; D1–D3]** Archive only after all tasks are complete, active RED is empty, dual Judgment and strict verify match the final tree, exact-head CI is green, and no exclusion changed. Cleanup owned fixtures/processes. Roll back by reverting U1 classifier/gap propagation with paired tests while retaining a coarse edge-free unfinished computed-element guard and all #247 foundations; never restore guessed or proven-empty authority.

## Initial Judgment Day — target `1ac6b84`

- Blind exact-target Judge A: 2 CRITICAL, 2 WARNING; Judge B: 2 CRITICAL, 3 WARNING.
- Corroborated defects: numeric-key support (A WARNING/B CRITICAL), work-budget accounting (A CRITICAL/B WARNING), and public/TOON evidence overstatement (A WARNING/B WARNING).
- Unconfirmed risks: generic constrained keys (A-only), endpoint identity deduplication (B-only), and unresolved exact strings completing silently (B-only).
- The contract does not authorize severity normalization. Therefore confirmed severe = 0, suspect severe = 2, contradictions = 0, INFO = 4; no correction IDs or R1 exist, and no correction/re-judgment round was used.
- Verdict: APPROVED with warnings/unconfirmed risks. This does not claim functional completeness or confer review, settlement, delivery, verify, CI, archive, Git, or GitHub authority. Ledger: `reviews/ledger.json`.

## Traceability Matrix (3 Requirements / 19 Scenarios)

| Scenario                               | Normative requirement | Primary assertion / task                           | Decision |
| -------------------------------------- | --------------------- | -------------------------------------------------- | -------- |
| S1 One literal key eligible            | R1                    | `test/impact.test.ts`; 1.2, 2.2                    | D1,D2    |
| S2 Union alternative unselected        | R1                    | `test/impact.test.ts`; 1.1–1.2                     | D1–D3    |
| S3 Alternative unresolved              | R1                    | `test/impact.test.ts`; 1.1–1.2                     | D1–D3    |
| S4 Outgoing union ambiguity            | R1                    | `test/impact.test.ts`; 1.1–1.2                     | D1–D3    |
| S5 Independent direct edge remains     | R1                    | `test/impact.test.ts`; 1.2, 2.2                    | D1,D2    |
| S6 Excluded dispatch non-authoritative | R1                    | `test/impact.test.ts`; 2.2                         | D1,D2    |
| S7 Independent authority boundary      | R1                    | scope/CI checks; 0.1, 3.3                          | D1–D3    |
| S8 Call classification                 | R2                    | `test/relationships.test.ts`; 1.1, 2.2             | D1,D2    |
| S9 Bounded canonical traversal         | R2                    | existing `test/call-spines.test.ts`; 0.2, 2.2      | D2,D3    |
| S10 Empty authority                    | R2                    | existing `test/call-spines.test.ts`; 0.2, 2.2      | D2       |
| S11 Union-key path unproven            | R2                    | `test/mcp.integration.test.ts`; 1.1–1.3            | D1–D3    |
| S12 Direct path plus ambiguity         | R2                    | `test/call-spines.test.ts`; 1.3, 2.2               | D2       |
| S13 JSON/TOON authority parity         | R2                    | `test/mcp.integration.test.ts`; 1.3, 2.2           | D2       |
| S14 Partial traversal rejected         | R3                    | existing candidate tests; 0.2, 2.2                 | D2,D3    |
| S15 Semantic gap rejected              | R3                    | existing `test/test-candidates.test.ts`; 0.2, 2.2  | D2       |
| S16 Proven empty result                | R3                    | existing candidate tests; 0.2, 2.2                 | D2       |
| S17 Computed ambiguity not certified   | R3                    | `test/mcp.integration.test.ts`; 1.1, 1.4           | D1–D3    |
| S18 Excluded dispatch not certified    | R3                    | impact/candidate controls; 0.2, 2.2                | D1,D2    |
| S19 Public fail-closed parity          | R3                    | `test/mcp.integration.test.ts` MCP+batch; 1.4, 2.2 | D2,D3    |

**Decision IDs:** D1 = shared classifier in `relationships.ts`; D2 = canonical bounded unfinished gaps/no guessed multi-edge; D3 = lazy request-local catalog charged to existing work bounds.
