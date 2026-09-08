```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:d8278ab4fbdf4766efafab62548570058a353a3adf3c3966021d9afe0bd9f07d
verdict: pass
blockers: 0
critical_findings: 0
requirements: 14/14
scenarios: 25/25
test_command: env -u GIT_PAGER yarn vitest run --exclude test/supervised-worker.integration.test.ts --reporter=dot
test_exit_code: 0
test_output_hash: sha256:15bd524bce016f024f21d82e0a1794a48d40a6b87600c365c904a081d8fa2fdf
build_command: yarn build
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verification Report

**Change:** `2026-09-06-issue-247-honest-scoped-call-coverage`
**Mode:** Strict SDD / Strict TDD remediation verification
**Candidate:** `0e3955ffe2f576b6f87f4c2e654eb0a15e89721e` (`tree 36297967e2b46a45a1be49c77acd8cd7c066d341`)
**Base:** `origin/main@3b57de77d21a7514cc6436f9824ea85fee285d9e`
**Active attempt:** `sha256:7f5cba93b225f8f24e7b6628aa1e938d7c4ce5e2ca97bc8e7ae48d7b12574f8f` (unsettled)
**Required passing-settle remediation:** `sha256:7d1e791a44ac709a2e68ebf1cef4ed4fffaaa5b480f0e6cfcb8e0ae18324ebc8`

## Verdict

**PASS.** All 14 requirements, 25 scenarios, reused local candidate evidence, dual-Node adapter/audit gates, and the fresh newest exact-head CI readback are green. The prior #256/#281 Node 24 failures were transient: unchanged failed jobs were rerun successfully in the same workflow runs. PR #266 is intentionally excluded from verification because it has not yet received this verification content; its exact pushed head must be green before archive/delivery. No settle, archive, Git, GitHub, runtime, test, or Harness mutation occurred.

## Identity, scope, and budget

- Candidate ancestry remains linear from `3b57de77` through approved `0e3955f`; runtime/test/script/config/benchmark/package objects remain unchanged.
- Active PR budgets remain #249 312, #250 168, #251 89, #252 282, #253 120, #254 332, #255 332, #280 101, #256 353, #281 52, #257 330, #282 57, #258 203, #283 46, #259 316, #260 299, #261 254, #262 291, #263 58, #264 240. Every listed child is ≤400.
- The final five-file evidence patch is independently counted at ≤400 additions plus deletions. Allowed edits are only verify-report/state/progress/tasks/ledger.

## Requirement and scenario compliance

| Requirement set   | Scenarios | Persisted executed evidence                           | Result    |
| ----------------- | --------: | ----------------------------------------------------- | --------- |
| SCI-R1–R3         |         5 | canonical lattice, applicability, containment         | COMPLIANT |
| SCI-R4–R5, SCI-R9 |         5 | direct calls and deferred/uncertain negative controls | COMPLIANT |
| SCI-R6–R8         |         5 | semantic/bounded split, honest emptiness, JSON/TOON   | COMPLIANT |
| ATC-R1–R2         |         6 | six-kind incoming admission and fail-closed cases     | COMPLIANT |
| ATC-R3–R5         |         4 | whole proofs, metadata, MCP/batch/inventory parity    | COMPLIANT |

All 14/14 requirements and 25/25 named scenarios remain compliant. Focused authority selection passed twice at 25/25, and each scenario maps to a concrete value, error, edge, or coverage assertion.

## Reused local command evidence

| Gate                                   | Result                               | Output/evidence SHA-256                               |
| -------------------------------------- | ------------------------------------ | ----------------------------------------------------- |
| Focused authority runs 1 / 2           | 25/25 each                           | `47e86fb4…` / `4e97cb83…`                             |
| Candidate/MCP/batch                    | 62/62                                | `0105184a…`                                           |
| Inventory/registry/canary/public-error | 102/102                              | `9fdd77f0…`                                           |
| Ordinary full + supervised isolated    | 994/994 + 2/2                        | `15bd524b…` / `8d0ade05…`                             |
| Lint / typecheck / build               | pass                                 | empty output `e3b0c442…`                              |
| MCP / lifecycle / CLI / errors         | pass                                 | `f6992c50…` / `49f7089a…` / `c3eb92e5…` / `64808d39…` |
| Package / pack / workflow policy       | pass                                 | `b8f31666…` / `c2c74987…` / `0a115cf9…`               |
| Benchmark runs 1 / 2                   | 8/8; `changed:false`; byte-identical | output `be262944…`; evidence `d3fd705e…`              |
| Audit Node 24 / Node 22.13             | pass; no suggestions                 | identical `45773d08…`                                 |

Node `v24.16.0` and exact runtime Node `v22.13.0` adapters pass. Both used authenticated private `pnpm@11.7.0`; Corepack remained unchanged (`3655bc79…`). Adapter-owned temporary resources were removed by the preceding verifier.

## Fresh newest exact-head CI

| Result  | PRs / exact newest workflow runs                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SUCCESS | #249 `34160989172`; #250 `34160991027`; #251 `34182998235`; #252 `34182999860`; #253 `34183002137`; #254 `34183003435`; #255 `34182224731`; #256 `34182622615` attempt 2; #257 `34182697448`; #258 `34182772637`; #259 `34182840599`; #260 `34182869358`; #261 `34182900319`; #262 `34182931131`; #263 `34182952593`; #264 `34182977441`; #280 `34182262695`; #281 `34182647317` attempt 2; #282 `34182720225`; #283 `34182795847` |

Exact rerun closure:

- #256 head `cd90f26c03f27c883c7831e11033c38bc3cae82a`, run `34182622615`: attempt 1 Node 24 job `101924595359` failed while Node 22.13 job `101924595517` passed; unchanged attempt 2 completed SUCCESS with Node 24 job `101934333779` and retained-green Node 22.13 job `101934335008`.
- #281 head `2300701e5a8a4337cfffdb7dc34a2a5e9dcb739f`, run `34182647317`: attempt 1 Node 24 job `101924670391` failed while Node 22.13 job `101924670194` passed; unchanged attempt 2 completed SUCCESS with Node 24 job `101934336929` and retained-green Node 22.13 job `101934338207`.
- Every other queried latest exact head remains completed SUCCESS. PR #266 is not a verification failure: after this report is committed and pushed there, its new exact-head CI is the sole pre-archive/delivery gate.

## Strict TDD, quality, and delivery state

- TDD evidence remains complete for U1–U5 and R1A–R1C: stable RED twice, GREEN/refactor, rollback, and ≤400-line slices are preserved. Assertion audit found no tautology, ghost loop, prose-only claim, or mock-heavy issue247 proof.
- Test layers remain unit/service plus MCP/batch integration. No coverage collector or browser E2E layer is configured; this is informational, not blocking.
- Names, comments, additive interfaces, accidental complexity, performance bounds, input/error handling, deterministic output, package behavior, security audit, diff hygiene, and exclusions remain accepted by terminal dual judgment and strict local evidence.
- Judgment remains terminal `APPROVED`; open confirmed/correction-caused severe = 0 and contradictions = 0. RDD is `disabled/unmanaged` and grants no settle/delivery authority.
- Checklist progress is 28/28. Strict verification is complete; only the archive/delivery phase remains. The active verification attempt remains unsettled exactly as directed.
- **Next:** parent commits and pushes only these five evidence artifacts to PR #266, verifies newest exact-head CI green on that pushed content, then performs separately authorized archive/delivery. Any later passing settle must remediate `sha256:7d1e791a44ac709a2e68ebf1cef4ed4fffaaa5b480f0e6cfcb8e0ae18324ebc8`.

## Skill Resolution

Loaded `dsh-sdd`, `sdd-verify`, strict-TDD verify, report format, shared SDD status/phase/review contracts, and daily engineering quality gates. The explicit no-delegation constraint was honored.

## Key Learnings

1. Both transient Node 24 failures passed unchanged same-run reruns.
2. Every required newest exact head is now green.
3. PR #266 CI belongs to delivery, not verification.
4. The active remediation attempt remains intentionally unsettled.
