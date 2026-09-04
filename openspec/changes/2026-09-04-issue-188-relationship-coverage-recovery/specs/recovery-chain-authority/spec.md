# Recovery Chain Authority Specification

## Requirements

### Requirement: Establish exactly one fresh tracker

Exactly one tracker MUST target `main`, start from the revalidated protected `origin/main` SHA, and remain draft and non-mergeable until every integration gate passes.

#### Scenario RCA-001: Tracker base

- GIVEN approved #188 and freshly fetched protected `origin/main`
- WHEN the tracker is created
- THEN its base equals that SHA and no second tracker exists.

#### Scenario RCA-002: Main drift

- GIVEN protected `origin/main` differs from the planning baseline
- WHEN chain creation is attempted
- THEN conflicts, allowlists, and line counts MUST be recalculated first.

### Requirement: Preserve bounded immediate-parent slices

U1–U7 MUST remain ordered slices: RED; coverage/tracker; calls; contains; schemas/candidates; matrix; docs/gates. U1 MUST target the tracker; later slices MUST target their immediate predecessor. Each review diff MUST contain only its scope and at most 400 authored additions plus deletions.

#### Scenario RCA-003: Clean slice

- GIVEN a slice targets its parent and has at most 400 authored changed lines
- WHEN admitted for review
- THEN only its allowlisted scope is presented.

#### Scenario RCA-004: Rejected slice

- GIVEN a diff includes ancestor work, foreign scope, or over 400 lines
- WHEN admission is evaluated
- THEN it MUST be retargeted, rebased, or split before review.

### Requirement: Create fresh lineage and exact links

Every child MUST have fresh identity, evidence, review, verification, and rollback. U1–U7 MUST use `Refs #188`; #186 and #187 MUST close only themselves and reference #188. Only integration MAY close #188.

#### Scenario RCA-005: Issue links

- GIVEN a #186 or #187 child is prepared
- WHEN links are inspected
- THEN it closes only its issue, not #188 or its sibling.

#### Scenario RCA-006: Recovery closure

- GIVEN any child or gate is incomplete
- WHEN #188 linkage is evaluated
- THEN no child or tracker action MAY close #188.

### Requirement: Reject inherited R-01 authority

Closed #161 and PRs #162–#185 MUST remain evidence only. Their receipts, Judgment, corrections, settlements, approvals, delivery/archive state, CI, and Harness snapshots MUST NOT authorize recovery. Historical hunks MAY inform allowlisted re-authoring after fresh reproduction but MUST NOT import old state.

#### Scenario RCA-007: Old authority

- GIVEN an old receipt or Judgment matches historical bytes
- WHEN a fresh candidate is evaluated
- THEN it grants no review, verification, archive, or merge authority.

#### Scenario RCA-008: Fresh identity

- GIVEN an allowlisted historical hunk informs a slice
- WHEN it is re-authored
- THEN fresh bytes, evidence, review, and verification are required.

### Requirement: Keep delegated limitations independently final

Callable dispatch finality MUST belong exclusively to #186. Complete exact-once request-wide sorting and finalization accounting MUST belong exclusively to #187. Each MUST remain separately specified, reviewed, verified, and rollback-capable; neither MAY accept or redefine the other. Foundation and tracker MUST NOT be merge-authorized while either is incomplete.

#### Scenario RCA-009: Dispatch boundary

- GIVEN #186 passes but #187 is incomplete
- WHEN eligibility is evaluated
- THEN dispatch acceptance stands but the tracker remains non-mergeable.

#### Scenario RCA-010: Accounting boundary

- GIVEN #187 passes but #186 is incomplete
- WHEN eligibility is evaluated
- THEN accounting acceptance stands but the tracker remains non-mergeable.

### Requirement: Bind final gates to one candidate

After both children pass, one unchanged candidate MUST receive fresh review without severe unresolved findings, strict verification, archive readiness, CI, and read-only Harness denial verification. Candidate-byte changes MUST invalidate bound review and verification evidence.

#### Scenario RCA-011: Final eligibility

- GIVEN every child and gate passes for one unchanged candidate
- WHEN eligibility is evaluated
- THEN the tracker MAY become merge-authorized and close #188 at integration.

#### Scenario RCA-012: Evidence drift

- GIVEN candidate bytes change or Harness shows writes or denial drift
- WHEN eligibility is evaluated
- THEN integration remains blocked pending fresh evidence or restored no-write proof.
