# Proposal: Preserve Computed-Key Call Uncertainty

## Intent

Issue #219 protects agents and maintainers from treating one compiler-selected branch of a computed union-key call as the only possible target. On PR #248 rebased to `main@7bb0c6800a9bfabddce11d26f61e00a90ed168b2`, the #247 prerequisite now supplies canonical per-kind/per-direction coverage, scoped call production, and fail-closed candidate admission. This change can therefore address the independently approved computed-key defect without inheriting #186, #188, or F-01 authority.

## Business and User Impact

A false authoritative edge or proven-empty result can cause an agent to omit affected callers or tests when reviewing a change. The safe observable outcome is that a union-key invocation remains unfinished whenever every relevant key alternative has not been bounded and selected as one exact project target. Useful exact evidence from other sites remains available, but uncertainty cannot be upgraded into absence proof.

If unchanged, `ast_get_impact`, `ast_explore.call_spines`, and `ast_find_test_candidates` can disagree about the same computed-key site or allow a selected alternative to hide another callable possibility.

## Scope

### In Scope

- Detect computed property access whose compiler-derived key domain contains multiple alternatives relevant to call dispatch.
- Preserve `unfinished` directional call coverage when at least one alternative is unsupported, unresolved, or not selected by the compiler-resolved target used for an exact-edge decision.
- Prevent a selected alternative from making the same site's call coverage authoritative, complete-empty, or proven-empty.
- Apply the same no-guess decision to scoped compiler impact and whole-project call-spine discovery so affected-test-candidate admission inherits conservative evidence.
- Preserve exact edges and completed coverage from independent, exactly resolved direct call sites when they coexist with this semantic gap.

### Non-Goals

- No new exact edge for property access, element access, external declarations, or multiple-target dispatch.
- No issue #220 external/local receiver-alternative convergence or proof.
- No `contains` producer, request-wide work-accounting redesign, runtime dispatch claim, index persistence, mutation, or universal schema work.
- No reopening or inheritance of issue #186, issue #188, F-01, Judgment, receipt, correction, settlement, review, merge, or delivery authority.
- No DeepSeek Harness or apply behavior changes.

## Core Invariant

For a computed property call with a union key, one selected alternative is insufficient authority. If any compiler-derived key alternative is unsupported, unresolved, or unselected, the invocation MUST emit no guessed exact call edge and MUST keep its applicable directional call coverage `unfinished`. Consequently, the affected result MUST be incomplete and MUST NOT be authoritative empty or proven empty.

A direct exact single-key property call may remain eligible under existing exactness rules when the compiler proves one project target. This proposal does not add property or element dispatch edges and does not weaken the canonical one-exact-target requirement.

## Affected Capabilities

| Capability                 | Required change                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scoped-compiler-impact`   | Refine deferred #219 classification while preserving canonical coverage cells, fail-closed precedence, and separate truncation/work evidence.        |
| `ast-explore-call-spines`  | Propagate computed-key semantic incompleteness so empty paths remain unproven and authority cannot be inferred from one selected alternative.        |
| `affected-test-candidates` | Continue rejecting `unfinished` six-kind incoming evidence with `INCOMPLETE_EVIDENCE`; no independent classifier or guessed candidate edge is added. |

No new capability or public relationship kind is introduced.

## Constraints

- Compiler evidence remains the only source of exact relationship authority; syntax or name matching cannot upgrade an edge.
- Canonical coverage states and ordering from `scoped-compiler-impact` remain unchanged: `not_applicable`, `completed`, `unsupported`, and `unfinished` with fail-closed aggregation.
- Semantic incompleteness remains distinct from traversal, work, cancellation, and pagination bounds.
- Existing edge shapes, public errors, JSON/TOON meaning, deterministic ordering, and freshness gates remain compatible.
- The implementation plan must fit the 400 changed-line review budget; `auto-chain` may split independently reviewable work if the forecast exceeds it.
- Current baseline authority comes from merged and archived issue #247 work on `main`; historical #186/#188 artifacts remain evidence only.

## Approach Decision

### Option A: Patch only whole-project call spines

This is small, but it leaves scoped impact and candidate admission dependent on different dispatch reasoning. It is rejected because surface disagreement would preserve the user-visible safety risk.

### Option B: Share one bounded computed-key uncertainty decision across existing producers

This is selected. It uses the canonical #247 coverage model, keeps uncertain sites edge-free, and propagates the same unfinished fact to impact, spines, and candidate admission without broadening dispatch support.

### Option C: Generalize property, element, external, and multiple-target dispatch

This could increase relationship recall, but it absorbs issue #220 and other unapproved semantics, increases reversal cost, and risks guessed authority. It is rejected.

## Testable Success Criteria

1. Given `base[key]()` where `key` is `"method" | "other"`, incoming `call` impact for either property emits no edge attributable to that ambiguous site, reports the applicable cell `unfinished`, sets `incomplete: true`, and sets `proven_empty: false` without claiming traversal truncation.
2. The corresponding outgoing call query for the owning caller remains edge-free for that site and reports outgoing call coverage `unfinished`.
3. Incoming and outgoing `ast_explore.call_spines` for either affected endpoint do not expose a guessed path; the response is incomplete/non-authoritative and `empty_proven` is false.
4. `ast_find_test_candidates` encountering that site returns stable `INCOMPLETE_EVIDENCE`, never an authoritative empty page.
5. A mixed result may retain exact edges from independent direct calls, but any relevant computed-key gap keeps aggregate completeness false and prevents proven emptiness.
6. Existing exact identifier function calls, constructors, tagged-template identifiers, freshness handling, bounds, canonical coverage order, and JSON/TOON logical parity remain unchanged.
7. Issue #220 controls remain unfinished and edge-free; tests do not claim external/local convergence.

## Compatibility

The intended compatibility change is conservative: responses that previously overclaimed exactness or emptiness become incomplete. Public kind names, edge fields, coverage vocabulary, errors, and serialization stay stable. Consumers already required to fail closed on `unfinished` evidence continue to do so; no migration grants mutation or apply authority.

## Risks and Mitigations

| Risk                                         | Mitigation                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Alternative enumeration misses a key branch  | Require compiler-derived bounded alternatives and default to `unfinished` whenever enumeration or selection is incomplete. |
| Scoped impact and call spines drift          | Use one semantic decision or shared contract and assert cross-surface parity.                                              |
| The fix expands into #220 or broad dispatch  | Keep external, property/element generalization, and multiple-target edges explicitly excluded and edge-free.               |
| Conservative results reduce candidate recall | Preserve useful exact edges while denying only unsupported authority; document incomplete evidence rather than guessing.   |
| Review scope exceeds 400 lines               | Forecast at spec/design and auto-chain only at independently testable boundaries; no size exception is implied.            |

## Rollback

Revert only the computed-key alternative classification and its paired parity tests. The canonical #247 coverage, scoped direct-call producer, consumer gates, and public metadata remain in place. After rollback, uncertain computed-key sites must fall back to edge-free `unfinished` behavior; rollback MUST NOT restore guessed exact edges, authoritative emptiness, or proven-empty claims.
