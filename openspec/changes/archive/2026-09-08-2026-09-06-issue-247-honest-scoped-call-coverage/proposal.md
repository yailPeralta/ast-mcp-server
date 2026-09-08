# Proposal: Honest Scoped Call Coverage

## Intent

Issue #247 requires distinguishing “no relationship found” from “not proved.” On immediate planning base PR #254 at `c5309ec`, absent scoped call/contains coverage lets impact and affected-test discovery falsely claim complete or proven-empty results.

## Scope

### In Scope

- Canonical coverage per requested relationship kind, incoming/outgoing direction, and endpoint applicability: `not_applicable`, `completed`, `unsupported`, or `unfinished`, aggregated fail-closed.
- Conservative scoped direct identifier calls, constructors, and tagged-template identifiers; ambiguous, unresolved, dynamic, property, or element dispatch remains edge-free and `unfinished`.
- Impact completeness/proven-empty derived from semantic coverage plus separate traversal/work bounds.
- Affected-test discovery frozen to six incoming kinds (reference, import, export, extends, implements, call), rejecting incomplete evidence.

### Out of Scope

- #219 computed union keys; #220 external convergence; a `contains` producer.
- Historical recovery/review inheritance; changes to whole-project call-spine authority.
- Universal MCP `outputSchema`, UI, Harness, runtime completeness, or mutation behavior.

## Capabilities

### New Capabilities

- `scoped-compiler-impact`: Per-kind/per-direction coverage, bounded scoped direct calls, and honest impact completeness/proven-empty semantics.

### Modified Capabilities

- `affected-test-candidates`: Admit results only after complete six-kind incoming evidence; publish incomplete evidence as an error.

## Approach and Measurable Outcomes

- Preserve all seven relationship kind strings and existing edge shapes; add canonical coverage/work/proven-empty metadata with JSON/TOON logical parity.
- Explicit/default applicable `contains` becomes `unsupported`; `incomplete` broadens from budget-only to budget-or-semantic incompleteness.
- Exact direct calls produce stable edges and completed directional cells; uncertainty affects only its applicable direction.
- Zero-edge impact is proven empty only when every requested applicable cell completed and no bound truncated/exhausted.
- Empty affected-test output is proven empty only after all six incoming cells complete; otherwise return `INCOMPLETE_EVIDENCE`.

## Authority and Delivery

Issue #247 alone authorizes implementation. PR #254/`c5309ec` is the immediate planning base, not delivery approval. Deliver five strict-RED units, each ≤400 authored changed lines and based on its immediate predecessor: U1 coverage contract; U2 impact propagation; U3 scoped direct calls; U4 candidate completeness; U5 docs/audit convergence. Each child includes tests, a usable finish state, and rollback. This sequential chain does not promise an atomic five-unit merge; each child is reviewed/delivered after its predecessor.

## Risks

| Risk                                           | Mitigation                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Former false-empty successes become incomplete | Document additive metadata and fail-closed migration.                                     |
| Broad uncertainty reduces usefulness           | Restrict incoming sites to target references and outgoing sites to the caller-owned body. |
| Coverage aggregation masks gaps                | Canonical ordering and precedence: unfinished > unsupported > completed > not-applicable. |
| A unit exceeds 400 lines                       | Split at an independently working behavior boundary; no size exception.                   |

## Rollback

Revert U5→U1. Reverting U3 must restore call cells to `unsupported`, never completed-empty. Remove U1 only after all consumers are reverted.
