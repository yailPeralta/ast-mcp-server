# Feature Branch Chain: Issue #247 Honest Scoped Call Coverage

## Governing Boundary

- **Implementation authority:** approved issue #247 only. **Planning base:** PR #253 commit `2675a02`, planning-only and not candidate, review, correction, archive, or delivery authority.
- **Mode:** RDD `disabled/unmanaged`; no receipt is implied. `sdd-attempt acquire/settle` is runtime-attempt coordination, never approval.
- **Edit rule during apply:** source, tests, and docs become editable only in their named unit under a future authorized apply context. This tasks phase edits this change directory only.
- **Excluded:** issue #219 computed union-key classification, issue #220 external convergence, `contains` producer, inherited #186/#188 authority, whole-project call-spine authority changes, universal MCP `outputSchema`, Harness/DSH apply, UI, mutation behavior, commit/push/PR/issue operations.
- **Budget:** authored additions plus deletions, including metadata/docs, MUST be ≤400 per unit. Generated goldens are excluded only from authored count but remain in candidate identity.

## Phase 0 — Authority and Baseline

1. Reconfirm issue #247 is open and `status:approved`; inspect conflicts/open PRs without mutation.
2. Resolve PR #253 commit `2675a02`; create tracker `feat/247-honest-scoped-call-coverage` at that commit only during apply.
3. Require a clean dedicated worktree/branch and record pre-existing paths. Reproduce the registered-MCP false empty and run `yarn vitest run test/relationships.test.ts test/impact.test.ts test/test-candidates.test.ts --reporter=dot` plus `yarn typecheck`.
4. Capture exact baseline CI and `yarn npm audit --all --recursive`; do not suppress or attribute unchanged failures to this change.
5. Before each unit, verify its branch base equals the immediate predecessor candidate and its diff excludes all earlier-unit changes from the child review view.

## Branch and Review Forecast

| Unit / branch                           | PR base and precondition                         | Forecast (hard max) | Independently usable finish                                                               |
| --------------------------------------- | ------------------------------------------------ | ------------------: | ----------------------------------------------------------------------------------------- |
| U1 `feat/247-u1-coverage-contract`      | tracker at PR #253 / `2675a02`; Phase 0 complete |       300–380 (400) | Resolver reports deterministic coverage; absent producers are never silently complete.    |
| U2 `feat/247-u2-impact-authority`       | U1 branch/candidate; U1 gates green              |       320–395 (400) | Impact exposes honest additive coverage/work/proven-empty while calls remain unsupported. |
| U3 `feat/247-u3-scoped-direct-calls`    | U2 branch/candidate; U2 gates green              |       330–395 (400) | Exact direct calls work; uncertain dispatch remains edge-free/unfinished.                 |
| U4 `feat/247-u4-candidate-completeness` | U3 branch/candidate; U3 gates green              |       320–395 (400) | Candidate results require complete six-kind incoming evidence.                            |
| U5 `docs/247-u5-contract-and-audit`     | U4 branch/candidate; U4 gates green              |       180–300 (400) | Public guidance, benchmark, inventory, and smoke evidence agree with runtime behavior.    |

PR #1 targets the tracker; each later PR targets its immediate predecessor branch. Only the tracker may eventually target main. Auto-chain authorizes planning this topology, not creating branches, commits, PRs, reviews, or delivery.

## Common Unit Protocol

For unit `U<n>`, call compact acquire before runtime-bearing work with request ID `issue247-u<n>-apply-v1`; proceed only on `state: proceed`, retain its token, and settle with distinct ID `issue247-u<n>-settle-v1`. Reuse an ID only for idempotent replay. A child actor authenticates the same active attempt with the parent token and never acquires blind. `blocked` or `complete` stops work.

Strict RED means: make test-only edits; run the card's exact command; record command, exit, failing test names, and normalized failure fingerprint; without editing source, tests, fixtures, config, lockfiles, or generated output, run the identical command again and require the same fingerprint. Any pass, changed fingerprint, flaky result, infrastructure failure, or unrelated failure stops the unit. Never publish a failing-test-only child.

After GREEN, refactor only while focused tests stay green. Every unit records exact focused result, runtime harness result or justified N/A, authored line count, changed paths, candidate identity, and rollback boundary. Then run `yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build`. A unit may be called a candidate only after its own gates and settle; it must not be called reviewed, approved, delivered, or archive-ready.

## U1 — Coverage Contract

- **Files/symbols:** `src/services/relationships.ts` — `RELATIONSHIP_EDGE_KINDS`, new `RELATIONSHIP_COVERAGE_STATUSES`, `RelationshipCoverageStatus`, `RelationshipEndpointClass`, `RelationshipCoverageEntry`, `RelationshipWork`, `CompilerRelationshipResolution`, `ScopedEdgeCollector`, `consumeScopedWork`, `createCompilerRelationshipResolver`/`edgesFor`, new `relationshipCoverageApplicability`, `canonicalRelationshipCoverage`, `mergeRelationshipCoverage`, `isRelationshipCoverageComplete`; `test/impact.test.ts` — resolver coverage cases.
- **RED twice:** `yarn vitest run test/impact.test.ts -t "relationship coverage" --reporter=dot`; expected failure is missing contract/14 ordered symbol cells or wrong fail-closed precedence.
- **GREEN/refactor:** add four-state canonical cells, endpoint/direction applicability, shared work snapshot, and producer completion registry. Applicable missing `call`/`contains` remains `unsupported`; N/A does not block.
- **Acceptance:** SCI-R1 S1–S2 and SCI-R2 S1–S2 (4 scenarios). Runtime harness: N/A—this unit is an internal resolver contract; public transport remains unchanged.
- **Rollback:** revert only the named relationships contract/registry and paired test hunks; legacy edge resolution remains. Do not remove U1 after U2 exists.

## U2 — Honest Impact Projection

- **Files/symbols:** `src/services/impact.ts` — `ImpactResult`, `assertExactImpactEvidence` (replace/complement with `assertCompleteExactImpactEvidence`), `collectNeighbors`, `traverseWithNeighborProvider`, `traverseCompilerImpact`; `src/tools/relationship-schema.ts` — new `RelationshipCoverageEntrySchema`, `RelationshipWorkSchema`; `src/tools/get_impact.ts` — `ImpactOutputSchema`, `registerGetImpact`; `test/impact.test.ts`, `test/mcp.integration.test.ts` — impact authority and JSON/TOON parity.
- **RED twice:** `yarn vitest run test/impact.test.ts test/mcp.integration.test.ts -t "honest impact|coverage work|proven empty|TOON" --reporter=dot`; expected failure is absent fields or applicable unsupported call/contains reported complete/proven-empty.
- **GREEN/refactor:** merge coverage/work from normal, restricted, and probe resolver calls; keep traversal truncation separate; compute `incomplete = truncated || work_limit_reached || !coverageComplete`; compute proven empty only for zero edges and complete authority.
- **Acceptance:** SCI-R3 S1, SCI-R6 S1–S2, SCI-R7 S1–S2, SCI-R8 S1 (6 scenarios). Runtime harness: `yarn test:mcp`, including registered `ast_get_impact` JSON/TOON logical parity.
- **Rollback:** revert only impact projection, schemas, handler fields, and paired tests; U1 remains internal and call cells remain unsupported.

## U3 — Scoped Direct Calls

- **Files/symbols:** `src/services/relationships.ts` — `ScopedEdgeCollector`, `consumeScopedWork`, `createScopedCandidateSet`, `scopedContainingSymbol`, `callLikeExpression`, `unwrapInvocationExpression`, `locatedCallTarget`, `createCompilerRelationshipResolver`/`edgesFor`, new `addScopedIncomingCalls`, `addScopedOutgoingCalls`; `test/impact.test.ts`, `test/relationships.test.ts` — exact shapes, ownership, directional uncertainty, and call-spine non-regression.
- **RED twice:** `yarn vitest run test/impact.test.ts test/relationships.test.ts -t "scoped direct call|constructor|tagged template|unfinished dispatch" --reporter=dot`; expected failure is call coverage still `unsupported` and no scoped exact edge.
- **GREEN/refactor:** incoming scans only target-resolving references; outgoing scans only owner body and skips nested named owners. Emit one project-resolved identifier target; property, element, dynamic, external, unresolved, or multiple targets emit no edge and mark only that direction unfinished.
- **Acceptance:** SCI-R4 S1–S2, SCI-R5 S1, SCI-R9 S1–S2 (5 scenarios). Runtime harness: `yarn test:mcp`, replaying the `createPaginationInputSchema` incoming-call regression.
- **Rollback:** remove scoped call producers/helper changes and paired tests; U1/U2 must restore `call: unsupported`, never completed-empty.

## U4 — Candidate Completeness Gate

- **Files/symbols:** `src/services/test-candidates.ts` — `findTestCandidates` and exact-evidence admission/path ordering; `src/tools/find_test_candidates.ts` — new `AFFECTED_TEST_RELATIONSHIP_KINDS`, `FindTestCandidatesOutputSchema`, `registerFindTestCandidates`; `test/test-candidates.test.ts`, `test/mcp.integration.test.ts`, `test/batch.test.ts` — six-kind gate, incomplete error, true empty, pagination, MCP/batch parity.
- **RED twice:** `yarn vitest run test/test-candidates.test.ts test/mcp.integration.test.ts test/batch.test.ts -t "six-kind|incomplete evidence|proven empty|whole proof" --reporter=dot`; expected failure is unfinished call evidence accepted or false empty published.
- **GREEN/refactor:** force incoming `reference/import/export/extends/implements/call`, exclude `contains`, require fresh exact resolved complete coverage/work, return stable sanitized `INCOMPLETE_EVIDENCE`, sort candidates before whole-proof pagination, and expose unpaginated authority metadata.
- **Acceptance:** ATC-R1 S1–S2, ATC-R2 S1–S4, ATC-R3 S1, ATC-R4 S1 (8 scenarios). Runtime harness: `yarn test:mcp && yarn vitest run test/batch.test.ts --reporter=dot`.
- **Rollback:** revert only candidate service/tool/schema/tests; honest impact remains available.

## U5 — Documentation and Audit Convergence

- **Files/symbols:** `README.md` impact/candidate contract sections; `docs/adr/0007-compiler-first-impact-relationships.md` completeness decision; `docs/adr/0012-public-affected-test-candidates.md` admission/pagination decision; `skills/structural-code-editing/SKILL.md` impact/candidate guidance; `benchmark/impact-corpus.json` honest coverage negative controls; `scripts/benchmark-agent-workflows.mjs` `runImpactCorpus`, `impactGateKeys`, `projectDeterministicReport`; `scripts/cli-smoke.mjs` `invoke`/impact and candidate assertions.
- **RED twice:** `yarn vitest run test/mcp.integration.test.ts test/batch.test.ts --reporter=dot && yarn benchmark:agent-workflows && yarn test:cli`; expected failure is missing inventory/metadata/smoke/benchmark contract assertion before docs/audit convergence.
- **GREEN/refactor:** synchronize terminology, six-kind admission, unsupported/unfinished behavior, additive JSON/TOON metadata, deterministic benchmark projection, CLI assertions, and managed skill claims without adding #219/#220 or Harness behavior.
- **Acceptance:** ATC-R5 S1–S2 (2 scenarios), plus convergence of all prior claims. Runtime harness: `yarn benchmark:agent-workflows && yarn test:cli`.
- **Rollback:** revert only the seven named docs/audit files; no source behavior is removed.

## Requirement and Scenario Map (14 / 25)

| ID     | Requirement                                  | Scenarios | Unit |
| ------ | -------------------------------------------- | --------: | ---- |
| SCI-R1 | Record canonical coverage cells              |         2 | U1   |
| SCI-R2 | Preserve applicability and direction         |         2 | U1   |
| SCI-R3 | Report unsupported containment               |         1 | U2   |
| SCI-R4 | Complete exact scoped direct calls           |         2 | U3   |
| SCI-R5 | Refuse guessed dispatch                      |         1 | U3   |
| SCI-R6 | Separate semantic and bounded incompleteness |         2 | U2   |
| SCI-R7 | Make impact claims honest                    |         2 | U2   |
| SCI-R8 | Preserve compatibility                       |         1 | U2   |
| SCI-R9 | Preserve deferred classifier scope           |         2 | U3   |
| ATC-R1 | Traverse incoming compiler relationships     |         2 | U4   |
| ATC-R2 | Fail closed on untrusted evidence            |         4 | U4   |
| ATC-R3 | Paginate whole candidate proofs              |         1 | U4   |
| ATC-R4 | Return trust and budget metadata             |         1 | U4   |
| ATC-R5 | Keep MCP and batch semantics identical       |         2 | U5   |

## Review Budget and Stop/Split Triggers

Forecast and measure every unit before production edits and again after refactor. **Stop before further edits** if forecast or actual authored delta exceeds 400, metadata was omitted from counting, base differs from the immediate predecessor, previous slices appear in a child diff, RED is not stable twice, a required gate fails for a change-caused reason, baseline drift cannot be classified, scope enters an exclusion, attempt state is not `proceed`, or rollback cannot be isolated.

Split only at an independently usable behavior seam, with tests/docs beside behavior and a new immediate-predecessor branch. Preferred emergency seams: U3 incoming exact calls → outgoing exact calls; U4 six-kind admission → public metadata/parity. Never split by file type, never create a failing-test PR, and never use a size exception. Update `tasks.md`, this chain, IDs, forecasts, trace, and progress before resuming.

## Complete Immutable Candidate, Judgment, Verify, CI, Archive

After U5 gates and settle, freeze one immutable complete candidate identity containing all five units and generated evidence. Then launch two blind, read-only Judgment judges in parallel with identical target, scope, criteria, and resolved skills. Wait for both; merge confirmed, suspect, contradiction, and INFO rows. Only severe findings confirmed by both are correction-eligible; ask before round one, allow at most two fix rounds and two scoped re-judgments, and freeze each fix delta. Contradiction, access failure, partial judgment, or unresolved severe finding yields `JUDGMENT: ESCALATED` and stops.

Only `JUDGMENT: APPROVED` permits independent strict verification on the exact final candidate: prove all 14 requirements and 25 scenarios, run focused/runtime evidence, `yarn format:check`, `yarn lint`, `yarn typecheck`, `yarn test`, `yarn build`, `yarn test:mcp`, `yarn test:cli`, `yarn benchmark:agent-workflows`, dependency audit, and required remote CI for the same identity. Any candidate change invalidates Judgment and verification and requires a new bounded candidate path.

Archive/delivery may proceed only after approved Judgment, strict verification, and CI policy pass. Judgment grants no receipt, commit, push, PR, merge, release, or archive authority; with RDD disabled/unmanaged, ordinary repository policy supplies any later delivery authority. This planning phase performs none of those operations.
