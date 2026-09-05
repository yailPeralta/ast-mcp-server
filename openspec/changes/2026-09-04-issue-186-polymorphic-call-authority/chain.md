# Issue #186 Polymorphic Call Authority Chain

## Authority, scope, and stop conditions

OpenSpec is authoritative in hybrid mode; mirroring remains skipped because runtime/control-plane edits are prohibited. [Issue #186](https://github.com/yailPeralta/ast-mcp-server/issues/186) is the approved bug authority. [Issue #188](https://github.com/yailPeralta/ast-mcp-server/issues/188) supplies only the recovery tracker/foundation. Immediate base is recovery U7 [PR #206](https://github.com/yailPeralta/ast-mcp-server/pull/206), branch `docs/issue-188-u7-docs`, commit `5d839bb1ee2550e5d0a6404784baa21121e188fa`.

Stop before edits if #186 loses `status:approved`, HEAD/base differs, PR #206 is not the immediate clean parent, another authority line conflicts, RDD is unsafe/unrecognized, a child exceeds 400 authored additions+deletions, a diff contains foreign paths/ancestor pollution, evidence/tree/cleanup hashes disagree, a gate fails, or review finds an unresolved candidate-caused severe defect. Never import or reuse #161 Judgment, receipts, lineage, approval, or settlement. Never implement #187, archive/merge any change, close #188, or inspect/edit Harness.

## Dependency diagram and budgets

```text
recovery U7 PR #206 @ 5d839bb
  └── #186A classifier/producer (220–320 authored lines) 📍
       └── #186B MCP/spine/candidate parity (80–160 authored lines)
            └── fresh #186-only review + 6/14 evidence
                 └── handoff to independent #187 apply
```

Total forecast is 300–480 authored changed lines, high risk; Feature Branch Chain is mandatory, with each child ≤400 lines and approximately ≤60 review minutes. A starts from PR #206 and ends with compiler-level authority and scoped producer proof. B starts from A and ends with public/consumer parity, candidate-bound evidence, and final #186 review. No size exception.

| Child | Planned branch                     | Immediate base         | Issue linkage             | Allowlist                                                                                   | Rollback                     |
| ----- | ---------------------------------- | ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------- |
| A     | `fix/issue-186-a-call-authority`   | PR #206 / `5d839bb`    | `Refs #186`, `Refs #188`  | `src/services/relationships.ts`, `test/impact.test.ts`, `test/relationships.test.ts`        | revert only A files/behavior |
| B     | `test/issue-186-b-consumer-parity` | #186A branch/candidate | `Fixes #186`, `Refs #188` | `src/services/relationships.ts`, `test/mcp.integration.test.ts`, `test/call-spines.test.ts` | revert only B parity changes |

A child diff showing PR #206 ancestors, or B showing A changes, has the wrong base and must be retargeted/rebased before review.

## Attempt lifecycle and receipts

First read attempt status. Reset is never automatic; it is legal only for a native decision-required/complete objective after explicit maintainer authorization and must bind the returned exact revision:

```bash
CHANGE=2026-09-04-issue-186-polymorphic-call-authority
/home/yail/.local/bin/gentle-ai sdd-attempt status --cwd "$PWD" --change "$CHANGE"
/home/yail/.local/bin/gentle-ai sdd-attempt reset --cwd "$PWD" --change "$CHANGE" \
  --expected-revision "$REVISION" --request-id issue186-a-reset-r1 \
  --reason "maintainer-authorized reset for approved issue 186 child A" --actor "$GENTLE_AI_RUNTIME_AGENT_ID"
```

Use each request ID only for its own idempotent replay. Child A uses `issue186-a-acquire-a1` and `issue186-a-settle-a1`; child B uses `issue186-b-acquire-a1` and `issue186-b-settle-a1`. If B alone requires an authorized reset, use `issue186-b-reset-r1`. A child process authenticates the same active attempt with the returned token rather than acquiring blind.

```bash
/home/yail/.local/bin/gentle-ai sdd-attempt acquire --cwd "$PWD" --change "$CHANGE" \
  --request-id issue186-a-acquire-a1 --work-unit issue186-a-classifier-producer \
  --evidence-goal "RED GREEN REFACTOR compiler-proven callable dispatch" \
  --max-attempts 2 --max-changed-lines 400
/home/yail/.local/bin/gentle-ai sdd-attempt settle --cwd "$PWD" --change "$CHANGE" \
  --token "$TOKEN" --request-id issue186-a-settle-a1 --outcome passed \
  --evidence-revision "sha256:$EVIDENCE" --diagnosis "all A scenarios and gates passed" \
  --harness-disposition invalidated --cleanup-evidence "$CLEANUP" --process-evidence "$PROCESSES"
```

Repeat with B IDs/work unit and B evidence goal. Failed or interrupted execution settles truthfully; it never resets itself. Record approval/base/conflict/RDD, acquire/settle, RED/GREEN/REFACTOR, focused/runtime/full gates, candidate identity, cleanup/process, review, and final 6/14 trace receipts in `apply-progress.json`.

## Strict RED/GREEN execution

A writes all compiler/service RED tests before production changes. RED must demonstrate false exact getter dispatch, false unfinished private and `#private` parameter calls, virtual/property/method/union/static uncertainty, endpoint-aware disjointness, directional isolation, stable identity, and unchanged generous work/cancellation controls. Then implement the smallest owner descriptor, static-binding precedence, receiver convergence, and scoped producer behavior in `relationships.ts`; refactor only while all A tests remain green.

B begins from accepted A. Write registered-MCP and consumer RED tests before B production changes: both issue fixtures in incoming/outgoing/both directions; global collection marks ambiguity incomplete; call spines cannot claim authority/emptiness; affected-test candidates reject unfinished call coverage while exact private evidence remains usable. Then make only the minimum shared global-collector/parity correction. Do not edit `src/services/impact.ts`, `src/services/context-builder.ts`, `src/services/test-candidates.ts`, tools/schemas, charging, sorting, retention, finalization, exact-bound, or one-below behavior.

Focused commands:

```bash
yarn vitest run test/impact.test.ts test/relationships.test.ts
yarn vitest run test/mcp.integration.test.ts -t "accessor|private|call|candidate"
yarn vitest run test/call-spines.test.ts
yarn typecheck
```

## Candidate identity and cleanup

For each child set `BASE` to its immediate predecessor and freeze only its allowlist:

```bash
git diff --numstat "$BASE"..HEAD -- <allowlist>
git diff --binary "$BASE"..HEAD -- <allowlist> | sha256sum
git rev-parse "$BASE^{tree}" HEAD^{tree}
sha256sum <allowlisted-files>
git diff --check "$BASE"..HEAD -- <allowlist>
git status --porcelain=v1 --untracked-files=all | sha256sum
ps -eo pid=,ppid=,stat=,command= | LC_ALL=C sort | sha256sum
```

The evidence revision binds command text, exit codes, output hashes, base/head commits and trees, ordered allowlist, authored numstat, patch/file hashes, RED failure signatures, GREEN results, cleanup status, and process snapshot. Require no temporary candidate files, no owned surviving process, and no unexpected worktree path. Any candidate-byte change invalidates settlement/review and requires fresh hashes and review.

## Full and package gates

Run on frozen B with `GIT_PAGER` unset and capture exit/output SHA-256:

```bash
yarn install --immutable
yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build
yarn test:mcp && yarn test:lifecycle && yarn test:cli && yarn test:errors && yarn test:package
git diff --check && git status --porcelain=v1 --untracked-files=all
```

Harness is deliberately `N/A` because this change prohibits Harness inspection/execution; no substitute claim is allowed.

## Independent #186 review

Recheck RDD immediately before review. If disabled, record `disabled/unmanaged`, fabricate no receipt, and use ordinary policy plus a fresh independent read-only adversarial inspection of exactly `5d839bb..#186B` limited to the two allowlists, requirements 6/14, candidate hashes, causal severity, and #187 exclusion. If enabled, route only through native review v2 `next_transition` and require a receipt bound to the same #186 tree/paths/evidence. The reviewer may not edit. Any finding-induced edit creates a new candidate and invalidates prior review. Old #161 Judgment is never a reviewer, lineage, or authority source.

## Requirement/scenario trace — 6/14

| Requirement                | Scenario                    | RED task | GREEN/evidence |
| -------------------------- | --------------------------- | -------- | -------------- |
| Prove callable dispatch    | Alternatives converge       | 1.1      | 2.1–2.2        |
| Prove callable dispatch    | Alternatives uncertain      | 1.1      | 2.1–2.2        |
| Prove callable dispatch    | Endpoint disjoint           | 1.3      | 2.2            |
| Cover virtual forms        | Callable getter override    | 1.1      | 2.1–2.2        |
| Cover virtual forms        | Callable property override  | 1.1      | 2.1–2.2        |
| Cover virtual forms        | Method and union dispatch   | 1.1      | 2.2            |
| Preserve exact controls    | Private owner parameter     | 1.2      | 2.2            |
| Preserve exact controls    | Non-virtual exact controls  | 1.2      | 2.1–2.2        |
| Preserve exact controls    | Polymorphic static receiver | 1.2      | 2.2            |
| Isolate/stabilize          | Directional isolation       | 1.3      | 2.2            |
| Isolate/stabilize          | Stable edge set             | 1.3      | 2.2            |
| Preserve work/cancellation | Runtime controls unchanged  | 1.3      | 2.3            |
| Keep consumers fail closed | Ambiguity reaches consumers | 3.2–3.3  | 3.4            |
| Keep consumers fail closed | Exact acceptance boundary   | 3.2–3.3  | 3.4–4.2        |

Threat matrix is N/A per design; no executable boundary row is silently omitted.

## Integration handoff

After both children are ≤400, settled, green, hash-bound, independently reviewed, and traced 6/14, hand the exact B candidate/base/tree/evidence receipt to the separately approved #187 change. #187 must start its own forecast, attempt, RED/GREEN, review, and candidate lineage; #186 grants no accounting authority. Do not verify/archive/merge here and do not close #188.
