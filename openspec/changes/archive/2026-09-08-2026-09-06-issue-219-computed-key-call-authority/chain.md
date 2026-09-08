# Auto-Chain Plan: Issue #219 Computed-Key Call Authority

## Governing Boundary

- **Authority:** approved issue #219 only; merged/archived #247 is the prerequisite foundation.
- **Independent/excluded:** #186, #188, and F-01 are historical evidence only. #220, Harness/DSH apply, `contains`, generalized property/element dispatch, external convergence, multiple-target edges, mutations, and runtime-dispatch claims are excluded.
- **Delivery:** `auto-chain`; selected topology is `feature-branch-chain`. The present `docs/219-design` branch is the planning/tracker baseline. This tasks phase creates no branch, commit, PR, review, acquire, settle, or delivery authority.
- **Budget:** every review child MUST remain ≤400 authored additions + deletions, including its evidence metadata. Generated artifacts, if any, remain in candidate identity even when excluded from authored count.

## Dependency Diagram and PR Targets

```text
main (contains merged #247)
  └─ planning/tracker: docs/219-design  [current planning baseline; future target: main]
       └─ U1: fix/219-computed-key-call-authority  📍 [future PR target: docs/219-design]
```

There is one runtime child because the forecast is 300–390 authored changed lines and code, tests, and evidence form one independently useful behavior. Splitting tests from producers or consumers would create non-green/non-reviewable children, so no artificial runtime split is planned. If the measured U1 diff exceeds 400, stop and amend this plan before edits continue; split only at a green producer/consumer seam, with the second child targeting the first child branch.

## Current and Future Boundaries

| Boundary          | Start                    | Independently reviewable finish                                                                                                                                | Forecast / hard max | Review target     |
| ----------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------: | ----------------- |
| Planning baseline | `main` with #247         | Proposal/spec/design/tasks/chain/progress/state only; no runtime authority                                                                                     |       planning-only | `main`            |
| U1 runtime child  | frozen `docs/219-design` | Computed union-key sites are edge-free/unfinished consistently across scoped impact, call spines, and candidate admission, while exact direct evidence remains |       300–390 / 400 | `docs/219-design` |

## Clean-Diff and Retarget Rules

1. Before U1, prove its base is the frozen planning baseline and its review diff contains only U1 source, tests, and evidence.
2. A child showing baseline-external or previous-slice changes has the wrong base: stop and retarget/rebase until the child diff is clean.
3. Never mix feature-branch-chain with stacked-to-main. Only the planning/tracker may ultimately target `main`; U1 targets the tracker.
4. Keep tests and evidence with behavior. Never publish a failing-test-only child or use `size:exception` without a new maintainer decision.
5. Stop for unstable RED, scope/exclusion entry, unknown baseline drift, missing edit authority, attempt state other than `proceed`, failed required gate, >400 authored lines, or non-isolated rollback.

## U1 Apply Protocol

- **Acquire identifier:** `issue219-u1-apply-v1`; invoke compact `gentle-ai sdd-attempt acquire` only during later apply and proceed only on `state: proceed`. Retain the opaque token; a child authenticates the same attempt with that token and never acquires blind.
- **RED twice:** run the exact filtered command from `tasks.md` twice after test-only edits. Both runs must exit 1 with the same test names and normalized fingerprint for the false selected/completed computed-key authority.
- **GREEN/refactor:** use the same command until exit 0, then run all six relevant test files, MCP/CLI built smokes, format, lint, typecheck, full test, build, and the existing agent-workflow benchmark.
- **Evidence:** baseline 141/141; stable RED×2 was 6 failed/1 passed with normalized hash `110fd82a`; GREEN was 6/6, focused six 147/147, MCP/CLI/full/benchmark passed, and U1 stayed ≤400. **Settle identifier:** `issue219-u1-settle-v1`; settlement remains prohibited and incomplete.
- **Rollback:** revert only the computed-key classifier/catalog, gap propagation, paired tests, and U1 evidence. Preserve #247 coverage and direct-call foundations plus an edge-free unfinished computed-element fallback; rollback must not restore guessed edges or proven emptiness.

## Review, Verification, CI, and Archive

Freeze one complete U1 candidate. Run two blind Judgment reviewers with identical scope and wait for both; a contradiction, partial result, access failure, or unresolved severe finding escalates. At most two explicitly authorized correction/re-judgment rounds are allowed, each on a frozen correction delta.

After dual approval, strict verification must prove all 3 requirements and 19 scenarios on the same candidate and admit the report with `gentle-ai sdd-verify-validate`. Required CI is the newest exact-head `.github/workflows/ci.yml` matrix on Node 22.13.0 and 24. Any candidate change invalidates Judgment, verification, and CI evidence.

U1 has no active RED and its local gates are green. Initial blind exact-target Judgment at `1ac6b84` is APPROVED with zero confirmed severe findings: A reported 2 CRITICAL/2 WARNING and B reported 2 CRITICAL/3 WARNING; the shared numeric and budget defects have mismatched severities, and the shared public/TOON evidence defect is warning-only. Generic constraints remain A-only; endpoint identity and unresolved exact strings remain B-only. The contract does not normalize those severities, so no correction authority or R1 exists and zero of two correction rounds were used. This verdict does not overclaim functional completeness and grants no delivery authority. Settlement, strict verification, exact-head CI, and archive/delivery remain incomplete. Next recommended work is settlement authorization/completion outside this Judgment scope; no archive, commit, push, PR, merge, release, or issue mutation occurred.
