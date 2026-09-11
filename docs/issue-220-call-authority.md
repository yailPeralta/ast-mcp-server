# Preserve uncertainty before call-target convergence

Issue [#220](https://github.com/yailPeralta/ast-mcp-server/issues/220) is an independent correction from `main@d9a87c7`, authorized in the maintainer session. It does not reopen #186/#188 or inherit their exhausted review authority.

## Decision

Agents must not receive an exact local call merely because a dependency alternative cannot be represented as a project symbol. Resolve every declaration before deciding convergence: an unlocatable alternative or multiple distinct local targets yields the existing `unfinished_gaps`, not an exact edge or a complete empty result.

Reuse the existing gap representation and spine consumer. Adding a public external-target state or expanding scoped property-call support would introduce unnecessary contracts. Keep a single local target exact only when no alternative was discarded. Endpoint identity includes its file, not only its selector.

## Reproduction and boundary

A real local declaration package supplies `External.method`. The fixture has zero compiler diagnostics, resolves both method declarations, and has no `any` receiver. On the unmodified baseline:

- `(flag ? new Local() : new External()).method()` produces a false exact local edge and authoritative incoming spine.
- Two local alternatives instead produce a falsely complete, empty incoming spine.
- Exact local method and identifier controls remain exact.
- Scoped impact and test candidates already fail closed for property dispatch under #247. They need no producer expansion.

`test/external-call-authority.test.ts` crosses the registered public MCP handler using the SDK's in-memory transport, not a mock handler or installed Harness. The initial 24-test baseline subset had **5 failures, 19 passes**; the expanded candidate has 45 tests. This proves the compiler/registered-MCP boundary only; it is not external Harness or installed-package evidence.

## Acceptance

| Requirement                                           | Assertion seam                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Never discard external uncertainty before convergence | Collector emits no guessed local method edge                                           |
| Distinct local alternatives remain ambiguous          | Collector is semantically incomplete; same selectors in separate files remain distinct |
| Uncertainty reaches consumers                         | Public spines are incomplete, never authoritative or falsely proven empty              |
| Preserve supported behavior                           | Exact-local method/identifier controls still emit exact edges                          |
| Preserve fail-closed scoped consumers                 | Public incoming impact remains unfinished; candidates return `INCOMPLETE_EVIDENCE`     |
| Separate semantics from bounds                        | Semantic gaps alone do not set `bounded_incomplete` or spine truncation reasons        |

## Constraints and rollback

No new public schema, flags, dependency, compiler version, Harness change, apply authority, or runtime deployment. The existing scoped deferred-call path reports discovery truncation; tests characterize it rather than claiming budget exhaustion. Broader receiver inference, inherited/generic dispatch completeness, computed-key work-accounting warnings, and #103 remain outside this correction.

Rollback is limited to the convergence change in `src/services/relationships.ts`, its new regression file, and this record. It does not remove #247/#219 or any backlog-cleanup comments. Verification and independent review must be completed before claiming delivery.
