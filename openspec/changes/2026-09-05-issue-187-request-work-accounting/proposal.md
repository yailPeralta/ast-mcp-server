# Proposal: Exact Request-Wide Work Accounting

## Intent

Issue #187 repairs a safety gap: sorting, retention, traversal, and finalization can perform unreported work and leak earlier authoritative nodes/edges after later exhaustion. The outcome is a reviewable stage/item contract covering the request without changing public meaning.

## Scope

### In Scope

- Define one unit as one item entering one named input-scaled stage; charge each stage/item exactly once, before observation or effect. Sorting reserves collection cardinality, not engine-dependent comparator calls; retention and emission are distinct stages.
- Thread the one mutable request-wide tracker through relationship production/finalization, neighbor collection, BFS dispatch/probes, coverage aggregation, and impact emission, with no reset or hidden authoritative allowance.
- Freeze exact-bound behavior: required work equal to `max_items` succeeds with `consumed_items == max_items` and `exhausted == false`. At one below, the first denied unit saturates the record, marks `exhausted`, returns `work_limit`, and leaves interrupted coverage unfinished.
- Make exhaustion transactional: emit no partial authority-bearing page, candidate page, or `proven_empty`; only the root identity may remain as diagnostics. Cancellation/deadline checkpoints precede charging, counter mutation, and stage effects, preserving typed cancellation precedence.
- Prove deterministic logical parity across JSON, TOON, registered MCP, batch/CLI consumers, and `ast_find_test_candidates` fail-closed behavior.

### Non-Goals

- No callable-authority work from terminal #186, no #219/#220 residuals, and no approval of recovery tracker #188.
- No new candidate-wide budget, relationship kinds, impact input, MCP tool, mutation/apply path, public work schema, or Harness change. Recovery already supplies `work`, coverage, truncation, and candidate fail-closed shapes.

## Capabilities

### New Capabilities

- `request-work-accounting`: Exact-once stage accounting, exhaustion authority, cancellation precedence, and deterministic impact behavior.

### Modified Capabilities

- `affected-test-candidates`: Reject exhausted/incomplete impact evidence before candidate projection on every public surface.

## Approach and Delivery

| Child | Boundary                                                                      | Budget             |
| ----- | ----------------------------------------------------------------------------- | ------------------ |
| #187A | Relationship stages and focused cardinality/exact-bound tests                 | ≤400 changed lines |
| #187B | Impact/BFS transactional accounting and public-consumer parity; targets #187A | ≤400 changed lines |

This feature-branch chain is a sibling from recovery U7 PR #206 and is based for proposal work on PR #221 commit `56eed43`; both children must integrate together. Behavior-first tests freeze named cardinalities before implementation.

## Risks and Rollback

Omitted or duplicate charges, pre-charge inspection, probe-local allowances, cancellation inversion, and ordering drift are the primary risks. Validate generous-budget output against exact-bound output and attack each stage independently. Before integration, abandon either child; afterward revert #187B then #187A, restoring U7 behavior without reviving excluded authority.

## Success Criteria

- [ ] Every input-scaled stage uses the single tracker exactly once per item.
- [ ] Exact-bound succeeds; one-below fails closed with no partial authority.
- [ ] JSON/TOON/MCP/batch/candidate results remain deterministic and compatible.
