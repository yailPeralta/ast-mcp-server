## Exploration: Issue #186 polymorphic call authority

### Current State

#### Phase status and authority

- Change: `2026-09-04-issue-186-polymorphic-call-authority`.
- GitHub issue #186 is open and labeled `status:approved` and `type:bug`.
- Main is exactly `6173a39a73f1540c17335a330ea7f14f982387cb` and is clean.
- R-01 issue #161 and PRs #162–#185 are closed unmerged by explicit maintainer decision. Their commits and `origin/docs/r01-u8-judgment-escalated` are evidence only, never delivery authority.
- Terminal evidence is commit `629801d6cbdd90c81dea2e7a7a870e3f45c05e6e`; its runtime parent is `22e38d2db5e8c23f0b1e98f455e755a5ba5405ed`.
- The `gentle-ai` status binary is unavailable. AST MCP tools were present, but project-status and symbol-search calls returned no model-visible content. Repository conclusions therefore use exact bounded source/git-object reads; the direct ts-morph probes below are compiler-backed but are not MCP freshness claims.
- OpenSpec is the authoritative persisted artifact. No Harness checkout was read or changed.

#### Deterministic defect reproduction

The terminal candidate's classifier was read directly from `629801d...:src/services/relationships.ts`. A no-file, in-memory ts-morph probe recreated its exact declaration-kind and check-order decisions.

**Callable accessor false exact**

```ts
class Base {
  get run(): () => void {
    return () => {};
  }
}
class Child extends Base {
  override get run(): () => void {
    return () => {};
  }
}
function caller() {
  const value: Base = new Child();
  value.run();
}
```

Compiler facts for `value.run()`:

- receiver type: `Base`; receiver declaration: `VariableDeclaration`;
- invoked-symbol declaration: `GetAccessor`;
- resolved-signature declaration: `FunctionType` whose ancestors are `GetAccessor → ClassDeclaration → SourceFile`;
- terminal `isPotentiallyPolymorphicInvocation()` recognizes only method declarations/signatures and property declarations/signatures (including their callable descendants), not a callable accessor or its `FunctionType` descendant;
- the receiver is neither `super`, union-typed, nor parameter-declared, so the terminal predicate returns `false` and the classifier selects the single base accessor as `exact`.

This certifies a guessed base target although runtime dispatch selects `Child.run`. It reproduces the first #186 defect against the latest terminal candidate.

**Private parameter false unfinished**

```ts
class Owner {
  private run(): void {}
  invoke(value: Owner): void {
    value.run();
  }
}
```

Compiler facts for `value.run()`:

- receiver declaration: `ParameterDeclaration`;
- invoked and resolved-signature declarations: the same private `MethodDeclaration` owned by `Owner`;
- terminal classification checks whether the receiver symbol is a parameter before checking whether the dispatch member is private;
- it therefore returns `unfinished`, even though TypeScript resolves the nominal private member and subclass declarations cannot override that private slot.

This reproduces the second #186 defect. Frozen round-two Judgment evidence independently records the same two outcomes under `J-R01-001` and reports 139 focused tests plus typecheck passing before rejection.

**Main separation**

The residual #186 classifier defect is absent/non-applicable on main, not fixed there:

- main has no `classifyCompilerInvocation()` or `isPotentiallyPolymorphicInvocation()`;
- main's scoped `createCompilerRelationshipResolver().edgesFor()` installs no `call` producer and exposes no relationship coverage ledger;
- main only has the older whole-project `collectCompilerCallRelationships()` inline resolver, while public scoped impact can return no call edge without proving call coverage;
- R-01's first RED is therefore still relevant on main, but #186's two terminal correction regressions cannot be patched or accepted independently against main's current architecture.

A narrow #186 diff applying only terminal classifier changes to main has no valid insertion point and cannot produce the required `coverage: unfinished/completed` acceptance proof.

### Architecture Map

#### Terminal scoped data flow

```text
ast_get_impact
  → resolveImpactRoot
  → traverseCompilerImpact (one request tracker + coverage observations)
  → traverseWithNeighborProvider (BFS, incoming/outgoing/both)
  → createCompilerRelationshipResolver.edgesFor(endpoint, query)
  → install kind/direction producer
       outgoing call → scan descendants of the selected caller body
       incoming call → scan project source files and call sites
  → classifyCompilerInvocation
       call/new/tag expression → unwrap wrappers
       → invoked symbol declarations + resolved signature declaration
       → polymorphism predicate
       → normalize overload/constructor implementation target
       → exact | disjoint | unfinished
  → exact: canonical caller→callee compiler edge
  → unfinished: no guessed edge + throw scoped unfinished marker
  → resolver coverage entry remains unfinished
  → impact.incomplete = true; complete-exact consumers fail closed
```

`collectCompilerCallRelationships()` also uses the classifier for whole-project call-spine discovery. Any correction must preserve global/scoped parity without substituting the global collector into per-node BFS.

#### Dispatch surfaces and current terminal behavior

| Surface                                              | Compiler evidence                                    | Safe authority                                                                                 | Terminal gap                                                 |
| ---------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Free function                                        | resolved signature plus function declarations        | exact only after overload declarations normalize to one body                                   | covered                                                      |
| Constructor / `new`                                  | construct signatures, class/constructor declaration  | exact when one canonical class implementation is proven                                        | covered                                                      |
| Public/protected method via interface/base/parameter | method signature/declaration plus receiver type      | unfinished unless one statically bound final target is proven                                  | known derived checks are only a negative proof, not finality |
| Callable property signature                          | `PropertySignature` plus `FunctionType`              | unfinished                                                                                     | round two added handling                                     |
| Callable property declaration                        | `PropertyDeclaration` plus arrow/function descendant | receiver-sensitive; base/interface/parameter dispatch is unfinished                            | round two added handling                                     |
| Callable getter/accessor                             | `GetAccessor` plus returned `FunctionType`           | receiver-sensitive; override-capable access is unfinished                                      | omitted, causing false exact                                 |
| `super.member()`                                     | `SuperKeyword` plus resolved base declaration        | exact; JavaScript/TypeScript statically binds `super` lookup                                   | round two preserves this                                     |
| Private method/property/accessor                     | private declaration owned by nominal class           | exact when the resolved private slot is unique, including an owner-typed parameter receiver    | parameter check runs too early                               |
| `#private`                                           | private identifier declaration                       | exact under the same unique-slot rule                                                          | needs explicit regression                                    |
| Lexical static `Base.run()`                          | class declaration receiver plus static member        | exact when the receiver expression denotes that exact class                                    | blanket static-member exemption is too broad                 |
| Parameter static `ctor.run()` / static `this.run()`  | `typeof Base` may carry a subclass constructor       | unfinished unless exact constructor identity is proven                                         | must not inherit blanket static authority                    |
| Union receiver                                       | constituent declarations and resolved signature      | unfinished unless every constituent resolves to the same statically bound final implementation | terminal always unfinished, safely conservative              |
| Overloaded method                                    | overload signatures plus implementation              | only after dispatch safety and unique implementation normalization                             | covered after receiver decision                              |

#### Incoming and outgoing coverage

- Outgoing coverage is local to the selected caller body and excludes nested named call owners. One applicable unresolved/polymorphic site must emit no guessed edge and keep outgoing call coverage `unfinished`.
- Incoming coverage scans project call sites. Exact sites targeting the selected declaration emit edges. A polymorphic site must poison incoming coverage only when compiler evidence cannot prove it disjoint from the selected target; unrelated ambiguous calls must not silently create authority, but global poisoning should be avoided where exact disjointness is available.
- `both` aggregates incoming and outgoing independently. One completed direction must not overwrite an unfinished direction.
- Edge provenance remains `compiler + exact + resolved + fresh`; a declaration-kind guess can never set `compiler_authoritative: true`.

### Compiler-Exact Rule Recommendation

Use a compiler-derived dispatch descriptor rather than a sequence of broad syntactic exclusions:

1. Recognize `CallExpression`, `NewExpression`, and tagged-template sites and unwrap only semantics-preserving wrappers.
2. Capture the resolved signature, invoked symbol declarations, receiver expression/type/symbol declarations, and all receiver union constituents before deciding authority.
3. Normalize callable ownership by walking from the signature declaration to the nearest callable member owner, including `MethodDeclaration`, `MethodSignature`, `PropertyDeclaration`, `PropertySignature`, `GetAccessorDeclaration`, and callable descendants. A `FunctionType` beneath an accessor must inherit accessor dispatch semantics.
4. Apply statically bound rules first: free functions, unique constructors, `super`, exact lexical class statics, and uniquely resolved private/`#private` members. The private decision must precede generic parameter uncertainty.
5. For virtual members, map each compiler-supported receiver alternative to canonical implementation declarations. Emit one exact edge only when every alternative is resolved, project-scoped, and converges to one statically bound final target.
6. Treat interface signatures, unresolved alternatives, anonymous/external targets, override-capable base access, callable accessor/property uncertainty, and divergent unions as `unfinished`. Emit no candidate edge.
7. Do not use member names, `getDerivedClasses()` absence, project scans, declaration count alone, casts, or selector coincidence as positive finality proof. Known derived declarations can disprove finality but cannot alone prove an open class final.
8. Preserve `disjoint` only where compiler evidence proves the site cannot target the queried incoming endpoint; otherwise fail closed as unfinished.

This policy is conservative: false unfinished results may reduce availability, while false exact results would violate authority.

### Affected Areas

- `src/services/relationships.ts` — terminal classifier, callable-owner normalization, scoped incoming/outgoing producers, global collector parity, and fail-closed coverage signaling.
- `test/impact.test.ts` — primary compiler-backed RED and dispatch matrix seam.
- `test/mcp.integration.test.ts` — public `ast_get_impact` proof for both defect fixtures and both directions.
- `test/relationships.test.ts` — whole-project collector/call-spine parity and declaration normalization.
- `test/call-spines.test.ts` — focused guard that no guessed terminal edge becomes an authoritative spine.
- `src/services/impact.ts` — dependency context only; #186 should avoid changing accounting/traversal logic reserved for #187.
- `src/tools/get_impact.ts` and `src/tools/relationship-schema.ts` — prerequisite recovery context; no #186 schema change is expected.

### RED Fixtures and Acceptance Proof

1. **Accessor override RED:** base-typed local holding `new Child()` invokes a callable getter. For caller outgoing and base-accessor incoming requests, assert zero guessed edges, call coverage `unfinished`, and `incomplete: true`.
2. **Private parameter RED:** an owner method invokes its private method through `value: Owner`. Assert one exact edge in outgoing and incoming directions, completed call coverage, and `incomplete: false`.
3. **Private identifier:** repeat with `#run` to prevent nominal-private drift.
4. **Member matrix:** method signature, callable property signature/declaration, callable accessor, abstract/base override, interface receiver, parameter receiver, and union receiver all fail closed unless one final target is compiler-proven.
5. **Exact controls:** free function, overload-to-body, `new` constructor, `super.method()`, lexical static call, and private call remain exact.
6. **Static negative control:** `ctor: typeof Base; ctor.launch()` and static `this` remain unfinished when subclass constructor dispatch is possible.
7. **Ownership controls:** nested named bodies do not leak into the outer caller; repeated exact sites deduplicate deterministically.
8. **MCP proof:** registered `ast_get_impact` returns the same edges, coverage, incomplete state, freshness, and authority as the service result for both issue fixtures.
9. **Spine/candidate proof:** guessed accessor edges never enter call spines or affected-test authority; exact private edges remain available.
10. Run focused RED first, then focused GREEN, then `format:check`, `lint`, `typecheck`, full `test`, `build`, MCP/package smoke, and `git diff --check`. Harness apply remains absent and is not touched or exercised by this change.

### Interaction With Issue #187

Issue #187 owns request-wide sorting/finalization accounting. #186 must not modify:

- `collectNeighbors` charging;
- source-file or containment-candidate sort charging;
- final retention/emission accounting;
- `max_items`, `consumed_items`, exact-bound, or one-below semantics.

#186 tests should use a generous work budget and assert only that it is not exhausted. Exact-bound and one-below fixtures belong exclusively to #187. The recovery integration cannot merge to main while #187's known severe authority defect remains, but #187 must remain a separate change, implementation unit, issue link, review, and acceptance objective.

### Delivery Baseline Approaches

1. **New recovery Feature Branch Chain from main (recommended)** — create a separately approved recovery/integration issue and tracker from `6173a39...`; replay the bounded, already-reviewed R-01 U1–U7 runtime/doc units without old R-01 OpenSpec state, Judgment artifacts, or delivery claims; then add independent #186 and #187 child units and perform fresh integration review.
   - Pros: preserves main ancestry, clean diffs, ≤400-line review slices, new authority, independent issue closure, and the explicit ban on reopening R-01.
   - Cons: requires maintainer approval of a new recovery issue/strategy; replay conflicts must be resolved and reverified; tracker cannot merge until both #186 and #187 are independently green.
   - Evidence: clean runtime-only historical units are approximately 51, 353, 320, 337, 288, 202, and 32 changed lines, each within the 400-line budget.
   - PR links: replay PRs link the new recovery issue; the #186 PR links/closes only #186; the #187 PR links/closes only #187; the draft/no-merge tracker references all dependencies and closes the recovery issue only after fresh final integration.
   - Effort: High overall, but bounded and reviewable.

2. **Branch from terminal candidate, then create a new tracker/integration line** — use `629801d...` as the code parent, add #186, and later reconcile to main.
   - Pros: fastest local access to the failing classifier and fixtures; smallest immediate #186 diff.
   - Cons: carries 3,492 additions/214 deletions over main, closed #161 artifacts, exhausted Judgment lineage, and partially corrected but still defective #187 accounting; obscures which evidence is new; still needs a recovery issue and cannot merge directly.
   - PR links: a new tracker/recovery issue is mandatory; old PRs remain closed evidence only. #186 cannot claim that the terminal branch itself supplies delivery authority.
   - Effort: Medium initially, High at integration; rejection risk is high.

3. **Narrow #186 patch directly on main** — alter only the two classifier cases.
   - Pros: superficially small.
   - Cons: main lacks the classifier, scoped call producer, coverage ledger, public coverage/work contract, candidate gate, and regression matrix; expected #186 outcomes cannot be expressed or verified. Reimplementing those under #186 would silently absorb R-01 and #187 scope.
   - PR links: #186 alone is insufficient authority for the prerequisite feature recovery.
   - Effort: Non-deliverable as scoped.

4. **Fold prerequisite recovery into #186** — rebuild enough R-01 architecture in one #186 chain.
   - Pros: one tracker.
   - Cons: changes #186 from a focused approved bug into a multi-thousand-line feature recovery, mislinks review evidence, and risks silently fixing or weakening #187.
   - Effort: High and not recommended without explicit issue-scope amendment.

### Recommendation

Use approach 1. Start a fresh recovery/integration issue and Feature Branch Chain from main. Replay only bounded U1–U7 deliverable units; do not replay PRs #181–#185 or their exhausted Judgment state as authority. Implement #186 and #187 as separate post-foundation children, with separate OpenSpec changes and reviews, and merge the tracker only after both defects and a fresh integration review pass.

A maintainer decision is required before proposal/apply work:

1. approve creation/use of a prerequisite recovery/integration issue; and
2. select the recovery Feature Branch Chain strategy, including whether #186 precedes #187 in the linear chain or both are integrated through explicitly coordinated child branches.

Until that decision, the change is explored successfully but delivery planning is blocked. This is not a request to reopen #161 or any closed PR.

### Review Size, Risks, and Rollback

- #186 itself is estimated at **300–480 authored changed lines**: 90–150 RED/matrix lines, 150–240 classifier/refactor lines, and 60–90 MCP/spine guards.
- `400-line budget risk: High`; split into two review units if forecast remains above 400: (A) RED + service classifier and (B) MCP/spine parity, each with its own focused proof and rollback.
- The prerequisite recovery is far above 400 lines and therefore requires a chain; no `size:exception` is recommended.
- Rollback #186 atomically by reverting classifier/normalization changes with their focused tests. Never retain tests/docs claiming exactness without the producer and coverage behavior they prove.
- Highest risks are false exact virtual dispatch, over-conservative global incoming poisoning, unsafe static exemptions, overload/accessor declaration mis-normalization, accidental #187 accounting edits, and contamination from old R-01 artifacts/receipts.

### Ready for Proposal

No. Exploration is complete, but proposal should begin only after the maintainer resolves the delivery-baseline/recovery-issue decision. After that decision, the next phase is `sdd-propose` for #186 with an explicit `dependsOn` relationship to the new recovery/integration change and an explicit conflict/ordering boundary with #187.
