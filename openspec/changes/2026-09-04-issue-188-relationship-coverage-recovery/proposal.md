# Proposal: Recover Honest Relationship Coverage

## Intent

Restore the foundation required by approved issues #186 and #187 through a Feature Branch Chain from `main`, without authority from closed R-01 issue #161 or PRs #162–#185.

## Scope

### In Scope

- Re-author U1–U7 as seven ≤400-line immediate-parent children: RED; coverage/work; scoped calls; direct contains; schemas/candidates; matrix; docs/gates.
- Attach #186 callable authority, then #187 request-work accounting, as separate children.
- Run fresh review, verification, archive, CI, and read-only Harness checks after both pass.
- Keep the tracker draft/no-merge as the kill switch until every gate succeeds.

### Out of Scope

- Reusing R-01 receipts, Judgment lineage, corrections, archive/delivery state, identities, or approvals.
- Cherry-picking old commits; Harness apply or edits; commits, pushes, PRs, issue mutations, or merges in this phase.
- Folding #186 or #187 acceptance into U1–U7.

## Capabilities

### New Capabilities

- `relationship-coverage-recovery`: Fresh coverage, completeness, scoped call/contains, public contract, cancellation, and compatibility requirements.
- `recovery-chain-authority`: Fresh ancestry, child isolation, linkage, non-mergeability, evidence, and integration-gate requirements.

### Modified Capabilities

- `affected-test-candidates`: Freeze six incoming kinds, exclude `contains`, and reject unsafe coverage or exhausted work before `proven_empty`.

## Approach

Create a tracker from rechecked `origin/main`; use allowlisted historical diffs only as provenance. Order: U1→U2→U3→U4→U5→U6→U7→#186→#187→fresh review/verify/archive/integration. U1 targets the tracker; later children target their immediate predecessor.

U1–U7 use `Refs #188`. #186 and #187 use `Fixes` only for themselves plus `Refs #188`; only final integration may use `Fixes #188`. U1–U7 temporarily leave polymorphic callable finality to #186 and complete request-wide charging to #187. Either limitation, a polluted/oversized diff, stale authority, severe finding, or failed gate keeps the tracker non-mergeable.

## Affected Areas

| Area                                                                    | Impact                         |
| ----------------------------------------------------------------------- | ------------------------------ |
| `src/`, `test/`, `docs/`, root public docs                              | Seven bounded foundation units |
| `openspec/changes/2026-09-04-issue-188-relationship-coverage-recovery/` | Fresh authority                |
| `openspec/specs/affected-test-candidates/spec.md`                       | Candidate safety delta         |

## Risks

| Risk                         | Mitigation                                    |
| ---------------------------- | --------------------------------------------- |
| Stale authority leaks        | Re-author; generate fresh identities/evidence |
| Main drift or polluted bases | Recheck ancestry, counts, and child diffs     |
| Temporary defects reach main | Require #186 and #187 before merge            |

## Rollback Plan

Before merge, abandon the tracker or revert a child and rebuild descendants. After merge, revert the integration atomically; never reactivate R-01 authority.

## Dependencies

- Approved issues #188, #186, and #187; revalidated protected `origin/main`.

## Success Criteria

- [ ] Seven clean ≤400-line U1–U7 children preserve scoped foundation behavior.
- [ ] #186 and #187 independently pass before integration.
- [ ] Fresh review, verification, archive readiness, CI, and no-write Harness checks bind one candidate.
- [ ] No old authority is reused; `main` stays untouched until all gates pass.
