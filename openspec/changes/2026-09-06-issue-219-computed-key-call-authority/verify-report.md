```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:82ac7fc1871a1c70916782b815b07c022c8589ac3d13af1d57d2ad3bea67561b
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 3/3
scenarios: 19/19
test_command: yarn vitest focused twice; six-file relationship/impact/spines/MCP/candidates/batch; env -u GIT_PAGER full excluding supervised; supervised separately
test_exit_code: 0
test_output_hash: sha256:cdbe1d5d736589f106cca0999b664995d538df02f80b4e4ed9e890121f076609
build_command: yarn format:check; lint; typecheck; build; MCP/errors/lifecycle/CLI/package/pack/workflow; benchmark twice; Node 24 audit; exact Node 22.13.0 adapter/audit
build_exit_code: 0
build_output_hash: sha256:c8fa425fa3253af86a100b904b2288e1dfd920899f76ff0a8bdac2d2c78e1d07
```

# Verification Report

**Change:** `2026-09-06-issue-219-computed-key-call-authority`
**Candidate:** HEAD `315c8873bb45e5c3ab8f2535b33fd733e0858ce6`; runtime target `1ac6b84a2df402e8275f417fed2bfb7605a20d07`; main `7bb0c6800a9bfabddce11d26f61e00a90ed168b2`
**Mode:** Strict TDD; RDD `disabled/unmanaged`; attempt `c907f531...` settled at evidence revision `sha256:82ac7fc1871a1c70916782b815b07c022c8589ac3d13af1d57d2ad3bea67561b`; no delivery authority.

## Completeness

| Metric                  | Result                                                         |
| ----------------------- | -------------------------------------------------------------- |
| Requirements            | 3/3                                                            |
| Scenarios               | 19/19                                                          |
| Workflow tasks          | 13/14; all pre-archive tasks complete; archive remains pending |
| Authored runtime budget | 365 additions + 35 deletions = 400/400 on PR #289              |

## Runtime gates

- Focused twice unchanged: 4 files, 6 passed/108 skipped each; exit `0,0`; stable names/counts.
- Relationships/impact/call-spines/MCP/candidates/batch: 6 files, 147/147; exit 0.
- Full excluding supervised: 76 files, 1000/1000 under `env -u GIT_PAGER`; supervised: 2/2; exit 0.
- Format, lint, typecheck, build, MCP, errors, lifecycle, CLI, package, pack, workflow policy: all exit 0.
- Relevant benchmark twice: identical log hash `be262944...`, evidence `d3fd705e...`, `changed:false`, all eight impact gates true.
- Node 24.16.0/Corepack 0.35.0 audit: clean. Exact Node 22.13.0/Corepack 0.30.0 audit: clean; adapter passed all phases using the intended pinned Node-24 Harness toolcache fallback; cleanup `ok` and owned processes `0`.
- Recovered evidence retained: the first full run failed only because ambient `GIT_PAGER=cat` correctly triggered its guard (`0463f104...`); clean-environment rerun passed (`a25262cb...`). The first Node-22 adapter run correctly blocked without a qualifying local Harness Node (`530cd4eb...`); the CI-shaped fallback rerun passed (`287e38f1...`).

## Spec compliance

| ID  | Scenario                            | Passing evidence                    | Result    |
| --- | ----------------------------------- | ----------------------------------- | --------- |
| S1  | One literal key eligible            | impact + six-file suite             | COMPLIANT |
| S2  | Union alternative unselected        | impact focused                      | COMPLIANT |
| S3  | Alternative unresolved              | impact focused                      | COMPLIANT |
| S4  | Outgoing union ambiguity            | impact focused                      | COMPLIANT |
| S5  | Independent direct edge remains     | impact focused                      | COMPLIANT |
| S6  | Excluded dispatch non-authoritative | impact controls + full suite        | COMPLIANT |
| S7  | Independent authority boundary      | policy/authority tests + full suite | COMPLIANT |
| S8  | Call classification                 | relationships focused               | COMPLIANT |
| S9  | Bounded canonical traversal         | call-spines suite                   | COMPLIANT |
| S10 | Empty authority                     | call-spines suite                   | COMPLIANT |
| S11 | Union-key path unproven             | MCP focused                         | COMPLIANT |
| S12 | Direct path plus ambiguity          | call-spines focused                 | COMPLIANT |
| S13 | JSON/TOON authority parity          | MCP/TOON + batch suites             | COMPLIANT |
| S14 | Partial traversal rejected          | candidate suite                     | COMPLIANT |
| S15 | Semantic gap rejected               | candidate suite                     | COMPLIANT |
| S16 | Proven empty result                 | candidate suite                     | COMPLIANT |
| S17 | Computed ambiguity not certified    | MCP focused                         | COMPLIANT |
| S18 | Excluded dispatch not certified     | impact/candidate controls           | COMPLIANT |
| S19 | Public fail-closed parity           | MCP focused + batch suite           | COMPLIANT |

## TDD and quality

| Check                 | Result                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------- |
| RED/GREEN evidence    | 1/1 work unit; RED twice stable, four test files exist, GREEN passes                      |
| Test layers           | 5 unit-style cases across 3 files; 1 MCP integration case; no E2E                         |
| Safety net            | Baseline 141/141; final six-file 147/147                                                  |
| Assertion audit       | No tautology, ghost-loop, type-only, smoke-only, or no-production-call assertion found    |
| Changed-file coverage | Skipped: no configured coverage provider                                                  |
| Design coherence      | Shared compiler classifier, bounded gaps, no guessed edge, canonical propagation retained |

## Exact-head CI

Fresh read-back found each newest PR run completed successfully at its current head; no obsolete, pending, or failed result was accepted.

| PR   | Exact head | Newest CI run | Result  |
| ---- | ---------- | ------------- | ------- |
| #248 | `d9e1cd01` | `34190733859` | success |
| #285 | `d36766a5` | `34191849984` | success |
| #286 | `f50ed0bc` | `34192681102` | success |
| #287 | `206c880a` | `34194250636` | success |
| #288 | `816be951` | `34195395305` | success |
| #289 | `1ac6b84a` | `34199482716` | success |
| #290 | `315c8873` | `34201296000` | success |

PR #290's exact-head matrix completed green on Node `22.13.0` and `24`; immutable install, Corepack, format, lint, typecheck, test/build, MCP/errors/lifecycle/CLI/package/adapter, audit, pack, workflow policy, and diff check all succeeded.

## Judgment and issues

Judgment target `1ac6b84` remains `APPROVED` solely because confirmed severe is zero. Its semantics are unchanged: 2 suspect-severe findings and 4 informational/warning findings remain; numeric-key support, work-budget accounting, public/TOON overstatement, generic constrained keys, endpoint deduplication, and unresolved exact strings are not erased or severity-normalized. Judgment supplies neither functional-completeness nor delivery authority; settlement was completed separately.

**CRITICAL:** None.
**WARNING:** The six retained Judgment risks above remain unresolved and outside correction authority.
**SUGGESTION:** None.

## Verdict

**PASS WITH WARNINGS.** All 3 requirements and 19 scenarios have passing runtime evidence, required local and exact-head CI gates are green, and the 400-line runtime budget is exactly met. Settlement is complete; only archive and delivery remain pending.
