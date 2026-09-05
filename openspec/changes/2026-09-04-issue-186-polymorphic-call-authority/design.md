# Design: Prove Polymorphic Call Authority

## Technical Approach

Over recovered U7 (`5d839bb`, PR #206), replace declaration-count classification with one pure compiler-evidence dispatch descriptor shared by scoped calls and call spines. It normalizes callable ownership, records receiver alternatives, and returns `exact` only for closed convergence, `disjoint` only for endpoint exclusion proof, otherwise `unfinished`.

## Architecture Decisions

| Decision                                 | Alternatives / tradeoff                                                      | Choice and rationale                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normalize owner before authority         | Classify raw symbol/signature kinds; misses accessor `FunctionType` ancestry | Walk invoked and resolved-signature declarations to the nearest `MethodDeclaration/Signature`, `PropertyDeclaration/Signature`, `GetAccessor`, constructor/class, or free callable; canonicalize overloads only after dispatch safety.                                                                                                                      |
| Prove binding before generic uncertainty | Parameter/union first is conservative but loses private exactness            | First recognize nominal `private`/`#private`, `super`, free/lexical-static, constructor, and unique implementation bindings; then evaluate open receiver dispatch.                                                                                                                                                                                          |
| Enumerate compiler alternatives          | Project scans/`getDerivedClasses()` guess a closed world                     | For each receiver union constituent, use compiler-resolved member declarations/signatures and owner ancestry. Interface/base/parameter receivers retain an open alternative; static `this` and `typeof Base` parameters retain constructor-valued openness. `new` uses construct signatures. Methods, callable properties, and accessors use the same path. |
| Endpoint-aware outcomes                  | Global ambiguity poisoning or name-based disjointness                        | Closed alternatives resolving to one project target are `exact`; fully resolved closed alternatives excluding the incoming endpoint are `disjoint`; divergence, external/anonymous declarations, open virtual slots, or unresolved evidence are `unfinished`.                                                                                               |
| Preserve edge contract                   | New dispatch IDs/schema                                                      | Feed only exact targets to existing `createRelationshipEdge`; IDs, ordering, deduplication, freshness, and `compiler_authoritative` remain unchanged.                                                                                                                                                                                                       |

### No-guess invariants

No member name, selector coincidence, cast, declaration count, known-derived absence, or project scan proves finality. Signature resolution alone does not prove runtime receiver dispatch. An unfinished site emits no edge and cannot prove emptiness.

## Data Flow

```text
call/new/tag → unwrap → normalize callable owner → static-binding rules
                                   ↓ otherwise
                         compiler receiver alternatives
                                   ↓
               exact target | incoming disjoint | unfinished
                  ↓                    ↓                ↓
       existing stable edge         ignore        direction unfinished
                  ├→ scoped impact coverage → candidate gate
                  └→ global collector incomplete → call-spine gate
```

Outgoing scans remain limited to the selected owner and exclude nested named owners. Incoming scans classify against the queried target so unrelated proven-disjoint sites do not poison coverage. `both` continues through existing per-direction producers and worst-status aggregation.

## File Changes

| File / lines                                      | Action                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/services/relationships.ts:2028-2168`         | Add descriptor/owner/alternative helpers; update scoped incoming/outgoing and global collector outcomes. |
| `test/impact.test.ts:1922-2070`                   | Add classifier matrix, directional coverage, IDs/dedup, and generous-budget controls.                    |
| `test/relationships.test.ts:197-226`              | Prove global collector parity and incomplete ambiguity.                                                  |
| `test/mcp.integration.test.ts:827-1035,1397-1493` | Prove public impact, spine, and affected-candidate fail-closed parity.                                   |
| `test/call-spines.test.ts:26-94`                  | Guard ambiguity from authoritative/empty spines.                                                         |

No schema/tool-registration change is required. `src/services/impact.ts:612-684`, `context-builder.ts:337-350`, and `test-candidates.ts:264-281` are parity checkpoints, not planned edits.

## Requirement / Scenario Trace (6 / 14)

| Req                                  | Scenario(s)                                                                      | Design / proof                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Prove callable dispatch              | Alternatives converge; Alternatives are uncertain; Endpoint is disjoint          | Descriptor convergence, unfinished, endpoint-aware disjoint; impact matrix.                                                                    |
| Cover virtual callable forms         | Callable getter override; Callable property override; Method and union dispatch  | Owner normalization plus receiver alternatives; impact matrix.                                                                                 |
| Preserve exact controls              | Private owner parameter; Non-virtual exact controls; Polymorphic static receiver | Static-binding precedence; private/#private, super/free/lexical-static/new/overload positives and static-this/constructor-parameter negatives. |
| Isolate coverage and stabilize edges | Directional isolation; Stable edge set                                           | Separate producers, existing aggregation/edge factory; incoming/outgoing ID tests.                                                             |
| Preserve work and cancellation       | Runtime controls remain unchanged                                                | Descriptor is pure: no tracker charges/checkpoints/sorts; generous-budget equivalence and cancellation regression.                             |
| Keep consumers fail closed           | Ambiguity reaches consumers; Exact acceptance boundary                           | Global `incomplete` drives spine authority; scoped unfinished call coverage rejects candidates; fresh U7-only MCP proof.                       |

## Work Units, Gates, and Rollback

- **A — RED + classifier (240–360 lines):** `relationships.ts`, `impact.test.ts`, `relationships.test.ts`; focused Vitest, then typecheck. Roll back these files together.
- **B — MCP/spine/candidate parity (100–180 lines):** integration and spine tests; focused MCP/Vitest. Depends on A; rollback tests only. If total exceeds 400 authored lines, deliver A then B as a Feature Branch Chain; no size exception.
- Final gates: `yarn format:check`, `yarn lint`, `yarn typecheck`, `yarn test`, `yarn build`, all configured smoke scripts, and `git diff --check`; require fresh independent review because closed #161/Judgment evidence transfers no authority.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable classification, or process boundary changes.

## Scope Boundary / Risks

#187 exclusively owns charging, sorting, retention/finalization, exact-bound, and one-below behavior; do not edit `impact.ts` accounting. Main risks are false exact open dispatch, over-poisoned incoming coverage, unsafe static authority, and owner mis-normalization. No migration is required.
