# Issue #187 Feature-Branch Chain

## Authority and immutable boundaries

Issue #187 is open with exactly `status:approved` and `type:bug`. Planning PR #225 is open at exact head `8fe8553097c169b7bba769c7e7f8fc8e90c97678` (tree `ddd126df77f481add273aa841aa6fc60efd7c898`), based on `docs/issue-187-design`, and is the immediate base for #187A. OpenSpec is authoritative in hybrid mode; runtime/control-plane mirroring is prohibited. RDD is `disabled/unmanaged`: ordinary policy applies and no receipt, approval, or managed correction claim may be fabricated.

Recovery U7 PR #206 remains open/unmerged at exact head `5d839bb1ee2550e5d0a6404784baa21121e188fa` (tree `be251608766fd29680309afb0e2d9a97b36cd20b`). The #187 planning lineage is its sibling feature line: #206 → #221 → #222 → #223 → #224 → #225. Terminal issue #186 and PRs #207–#218 are closed/unmerged historical evidence only. Separate #219/#220 are open, unapproved, and excluded; #188 is open/unmerged and its merge/archive stays excluded. No conflicting #187 implementation PR exists. No Harness work, apply/mutation feature, or new public schema/tool/error/input may enter either child.

```text
PR #206 docs/issue-188-u7-docs @ 5d839bb
  └── #187 planning PRs #221 → #222 → #223 → #224 → #225
       └── PR #225 docs/issue-187-tasks @ 8fe8553
            └── 📍 #187A fix/issue-187-a-relationship-accounting
                 base = exact PR #225 head 8fe8553
                 └── #187B fix/issue-187-b-impact-accounting
                      base = exact accepted #187A head captured before branching
                      └── frozen read-only review → strict verify 9/13
```

A child diff containing its parent or foreign paths has the wrong base and must be retargeted/rebased before review. Both children integrate together; rollback order is B then A.

## Phase 0 admission freeze

Observed at `2026-09-05T18:20:28Z` without repository, runtime-ledger, GitHub, or Harness mutation:

- Workspace branch/HEAD: `docs/issue-187-tasks` at exact PR #225 head `8fe8553097c169b7bba769c7e7f8fc8e90c97678`; parent `e4550df400aa5fda25f55e9d6bee6c23474a60b7`.
- Clean base: tree `ddd126df77f481add273aa841aa6fc60efd7c898`; base-to-HEAD numstat `0+0=0`; empty porcelain-status SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- A branch plan: create `fix/issue-187-a-relationship-accounting` from exact base commit `8fe8553097c169b7bba769c7e7f8fc8e90c97678`; do not retarget to a moving ref.
- A candidate identity fields: issue `187`; change `2026-09-05-issue-187-request-work-accounting`; projection `base-diff`; base PR/ref/commit/tree as above; planned head branch as above; head commit/tree, authored numstat, exact path manifest, patch SHA-256, focused-output SHA-256, and cleanup SHA-256 remain `pending` until A freeze and MUST be captured from the immutable candidate.
- Attempt ledger: virgin (`revision=""`, `binding_revision=""`, `objective_generation=0`, `next_ordinal=1`, cumulative/lifetime attempts and changed lines all 0, `complete=false`, `decision_required=false`, `next_action=begin`). Reset before A is neither needed nor authorized.
- Next root action is the exact A acquire documented below. Only `state: proceed` authorizes the runtime-bearing A work unit; `blocked` or `complete` stops.

## Budgets and allowlists

| Child | Start → finish                                                      | Exact allowlist                                                                                                                                                                                                                                                   | Forecast | Focused/runtime evidence                                                                                                                                         | Rollback                                     |
| ----- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| A     | Existing undercount → complete relationship/legacy stage accounting | `src/services/relationships.ts`; `test/impact.test.ts`; `test/relationships.test.ts`; `test/context-builder.test.ts`; this change’s `tasks.md`, `chain.md`, `apply-progress.json`, and `state.yaml`                                                               |  330–390 | `yarn vitest run test/impact.test.ts test/relationships.test.ts test/context-builder.test.ts`; runtime N/A—internal service boundary, public parity belongs to B | Revert A source and paired tests; abandon B. |
| B     | A accepted → transactional impact and public parity                 | `src/services/impact.ts`; optional proven-needed `src/tools/find_test_candidates.ts`, `src/services/context-builder.ts`; `test/impact.test.ts`; `test/test-candidates.test.ts`; `test/mcp.integration.test.ts`; `test/batch.test.ts`; this change’s four trackers |  350–400 | focused suites plus registered MCP/batch tests; no Harness                                                                                                       | Revert B only, then A if full rollback.      |

Before edits and before freeze, compute authored additions+deletions from the immediate parent. If forecast or actual exceeds 400, stop and split before apply: A1=producer/source/contains, A2=merge/finalization/legacy; B1=neighbors/BFS/transaction, B2=candidate/MCP/batch parity. No `size:exception` is planned.

## Frozen stage-vector evidence

Each event is `{stage,count,before,after}` on the same tracker. Sorts reserve cardinality; per-item stages charge immediately before inspection/effect. Map/Set/heap primitives and comparator invocations are never separate units.

| Owner       | Required named stages                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A/source    | `source.enumerate`, `source.path_sort`, `source.lookup_emit`                                                                    |
| A/producer  | `producer.dispatch`, `candidate.retain_attempt`, `candidate.sort`, `candidate.emit`                                             |
| A/contains  | existing inspect and emit unchanged; add only `contains.candidate_sort`                                                         |
| A/finalize  | `merge.scan_retain`, `merge.sort`, `selection.scan` (`min(M,limit)+[M>limit]`), `selected_id.sort`, `edge.emit`                 |
| A/legacy    | source sort, edge retention/dedupe, final sort, selection, emission                                                             |
| B/neighbors | `neighbor.edge_sort`, `neighbor.edge_scan`, `neighbor.retain_attempt`, `neighbor.sort`, `neighbor.emit`                         |
| B/BFS       | `bfs.dequeue`, `bfs.dispatch` including every probe, `bfs.classify_filter`, `bfs.edge_retain`, `bfs.node_retain`, `bfs.enqueue` |
| B/result    | `result.node_sort`, `result.edge_sort`, `coverage.aggregate`, `result.node_emit`, `result.edge_emit`                            |

Evidence must prove vector equality across repeated generous and exact runs, no reset, no duplicate stage/item pair, `before+count=after`, failed reserve has no guarded effect, and cancellation leaves count unchanged.

## RED/GREEN matrices

### A — relationship producer/merge/finalization/legacy

| Case                        | RED signature                                                             | GREEN acceptance                                                         |
| --------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| source paths                | old count omits retained-path sort and lookup/emission                    | all three source stages present before work                              |
| generic/contains candidates | retention/sort/emission missing or contains inspection/emission recharged | one attempt/sort/emission each; contains adds sort only                  |
| producer merge              | producer dispatch and edge merge absent                                   | each producer and producer edge charged once                             |
| selection/final emission    | N equals old undercount; N-1 still returns edges                          | asserted vector defines N; N succeeds; N-1 saturates with zero authority |
| legacy/spine                | exhaustion returns partial edges or complete spine                        | no edges/spine; `incomplete=true`                                        |
| stable output               | repeated IDs/order or exact/generous bytes differ                         | normalized bytes and IDs are identical                                   |

### B — neighbors/BFS/transaction/public surfaces

| Case                     | RED signature                                                                       | GREEN acceptance                                                                |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| collectNeighbors         | sort/scan/retention/final sort/emission absent                                      | one charge per named stage/item                                                 |
| BFS/probes               | dequeue/dispatch/probe/classify/retain/enqueue absent or probe uses local allowance | every path uses the request tracker                                             |
| exact/generous/one-below | exact self-calibrates to old count or N-1 leaks page                                | generous=exact bytes/vector; N-1 root-only, no edges/proven-empty               |
| late exhaustion          | earlier successful batches survive                                                  | authority scratch is discarded atomically                                       |
| cancellation collision   | denied charge becomes `work_limit` or mutates count first                           | typed `REQUEST_CANCELLED`, unchanged count, no partial result                   |
| candidates/spines        | projector runs or page/spine survives                                               | existing `INCOMPLETE_EVIDENCE(work_limit)` before projection; no complete spine |
| JSON/TOON/MCP/batch      | decoded values or ordering diverge                                                  | repeated JSON bytes stable; decoded TOON/MCP/batch logically equal              |

### Fourteen-cell direction matrix

| Kind         | incoming           | outgoing                                           | `both` rule                |
| ------------ | ------------------ | -------------------------------------------------- | -------------------------- |
| `reference`  | one canonical cell | one canonical cell                                 | compose both, no duplicate |
| `import`     | one canonical cell | one canonical cell (`not_applicable` where static) | compose both, no duplicate |
| `export`     | one canonical cell | one canonical cell (`not_applicable` where static) | compose both, no duplicate |
| `extends`    | one canonical cell | one canonical cell                                 | compose both, no duplicate |
| `implements` | one canonical cell | one canonical cell                                 | compose both, no duplicate |
| `call`       | one canonical cell | one canonical cell                                 | compose both, no duplicate |
| `contains`   | one canonical cell | one canonical cell                                 | compose both, no duplicate |

Canonical order is kind order above, then incoming before outgoing. Completion marks all applicable cells `completed`; work exhaustion rebuilds every interrupted applicable cell as `unfinished`, retaining static `not_applicable` only.

## Native attempt plan

Use one request ID only for its own idempotent replay; never reuse it for another operation. Child processes authenticate the same active attempt with A/B’s token instead of blind acquire.

```bash
CHANGE=2026-09-05-issue-187-request-work-accounting
GA=/home/yail/.local/bin/gentle-ai

# A
$GA sdd-attempt acquire --cwd "$PWD" --change "$CHANGE" \
  --request-id issue187-a-acquire-01 --work-unit issue187-a-relationship-accounting \
  --evidence-goal "Prove exact relationship and legacy stage accounting" \
  --max-attempts 2 --max-changed-lines 400
$GA sdd-attempt settle --cwd "$PWD" --change "$CHANGE" --token "$A_TOKEN" \
  --request-id issue187-a-settle-01 --outcome passed --evidence-revision "sha256:<a-evidence>" \
  --diagnosis "A exact-bound vectors and legacy fail-closed checks pass" \
  --harness-disposition invalidated --cleanup-evidence "<clean-status-hash>" \
  --process-evidence "N/A: no owned external process; snapshot recorded"

# Only if B changes the settled objective: stop until a maintainer explicitly authorizes this exact reset.
$GA sdd-attempt reset --cwd "$PWD" --change "$CHANGE" \
  --expected-revision "sha256:<post-a-runtime-revision>" --request-id issue187-b-reset-01 \
  --reason "Maintainer authorized distinct B impact-transaction objective after settled A" \
  --actor "<authorizing-maintainer>"

# B
$GA sdd-attempt acquire --cwd "$PWD" --change "$CHANGE" \
  --request-id issue187-b-acquire-01 --work-unit issue187-b-impact-transaction \
  --evidence-goal "Prove transactional BFS and public fail-closed parity" \
  --max-attempts 2 --max-changed-lines 400
$GA sdd-attempt settle --cwd "$PWD" --change "$CHANGE" --token "$B_TOKEN" \
  --request-id issue187-b-settle-01 --outcome passed --evidence-revision "sha256:<b-evidence>" \
  --diagnosis "B exact-bound transaction and public parity checks pass" \
  --harness-disposition invalidated --cleanup-evidence "<clean-status-hash>" \
  --process-evidence "<registered MCP/batch process cleanup hash>"
```

If B is the same objective and native authority allows continuation, do not fabricate a reset; record that decision and use the returned compact state. Any blocked/complete result stops execution.

## Freeze, review, and verification gates

For each child capture immediate-parent/head trees, allowlist, numstat, diff SHA-256, `git diff --check`, focused command output/exit hash, cleanup status, and process readback. Exact-bound output must equal generous output after only documented timestamp normalization; one-below must fail closed.

After B, freeze one exact A+B candidate. An independent read-only adversarial reviewer inspects the immutable trees for omissions, double charge/reset, pre-charge effects, late authority leakage, cancellation inversion, 14-cell errors, and output drift. The reviewer cannot edit source or authority. Any candidate-caused severe finding invalidates the candidate; corrections create a new frozen candidate and repeat review. With RDD disabled/unmanaged, this is evidence under ordinary policy, not a native receipt.

Final gates:

```bash
yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build
yarn vitest run test/impact.test.ts test/relationships.test.ts test/context-builder.test.ts \
  test/test-candidates.test.ts test/mcp.integration.test.ts test/batch.test.ts
git diff --check
/home/yail/.local/bin/gentle-ai sdd-verify-validate \
  --input openspec/changes/2026-09-05-issue-187-request-work-accounting/verify-report.md \
  --requirements 9 --scenarios 13
```

Admission requires zero exits, exact output hashes, no active RED, each child ≤400, stable JSON/TOON logical parity, and the frozen reviewed tree. The next route after tasks is apply/authority. Archive, integration, issue closure, and all #188 merge/archive work remain out of scope.
