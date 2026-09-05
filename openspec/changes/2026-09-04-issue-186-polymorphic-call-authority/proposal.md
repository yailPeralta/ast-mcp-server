# Proposal: Prove Polymorphic Call Authority

## Intent

Resolve #186’s J-R01-001 successor with a compiler-proven dispatch descriptor. Unresolved virtual dispatch must fail closed without discarding statically exact calls.

## Scope

### In Scope

- Describe receiver alternatives, callable member ownership, resolved signatures, and canonical implementations for call/new/tag sites.
- Mark override-capable methods, properties, and accessors ambiguous unless every alternative converges on one implementation.
- Preserve exact private/`#private` owner slots through owner-typed parameters, `super`, free/static/constructor calls, and unique overload implementations.
- Apply identical classification to scoped incoming/outgoing producers and whole-project call-spine collection; ambiguous edges cannot authorize affected-test candidates.
- Add focused compiler/service, registered-MCP, relationship, and call-spine regressions with generous work limits.

### Out of Scope

- #187 charging, sorting, finalization, exact-bound, or one-below work.
- Replaying U1–U7, merging/archiving changes, Harness changes, or reviving/extending #161 Judgment.
- Commits, pushes, PR/issue mutations, integration, or final recovery approval.

## Capabilities

### New Capabilities

- `polymorphic-call-authority`: Compiler-proven exact, convergent, disjoint, and unfinished dispatch semantics in both directions.

### Modified Capabilities

- `ast-explore-call-spines`: Exclude guessed polymorphic edges from authoritative spines.
- `affected-test-candidates`: Reject candidate authority when applicable call coverage is ambiguous.

## Approach

Normalize the invoked symbol and signature declaration to a dispatch owner, including callable descendants of methods, properties, and getters. Evaluate compiler-supported receiver alternatives, applying statically bound rules before parameter uncertainty. Return `exact` only for one canonical target, `disjoint` only with compiler proof, otherwise `unfinished`; preserve per-direction contamination rather than globally poisoning unrelated incoming queries.

## Affected Areas

| Area                                                              | Impact                                    |
| ----------------------------------------------------------------- | ----------------------------------------- |
| `src/services/relationships.ts`                                   | Dispatch descriptor and shared classifier |
| `test/{impact,mcp.integration,relationships,call-spines}.test.ts` | Authority matrix and public parity        |

## Risks

| Risk                          | Mitigation                                       |
| ----------------------------- | ------------------------------------------------ |
| False exact virtual dispatch  | Convergence required; fail closed                |
| Over-broad incoming poisoning | Preserve compiler-proven disjointness            |
| Scope leakage into #187       | Generous budgets; no accounting assertions/edits |

## Rollback Plan

Revert the descriptor/classifier and its paired tests as one #186 unit; the U7 foundation remains intact and non-mergeable.

## Dependencies and Budget

- Depends on `2026-09-04-issue-188-relationship-coverage-recovery` U7 candidate (PR #206, `5d839bb`), which remains unmerged and non-authoritative until #186, #187, and final gates pass.
- Forecast: **300–480 authored changed lines**. If the final plan exceeds 400, require two children: A) RED + descriptor/classifier; B) MCP/relationship/spine/candidate parity. No size exception.
- Require fresh independent review for the frozen #186 candidate; no #161 Judgment authority transfers.

## Success Criteria

- [ ] Override-capable method/property/accessor calls are unfinished unless alternatives converge.
- [ ] Private/`#private` parameter calls and exact `super`/free/static/constructor/unique-overload controls remain exact.
- [ ] Incoming/outgoing coverage and spine/candidate consumers emit no guessed authority.
- [ ] #187 and recovery/finalization scope remains untouched.
