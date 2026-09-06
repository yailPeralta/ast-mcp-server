# F-01 Delivery Route

Authority: issue #235 (`status:approved`, `type:chore`), branch `test/f01-json-toon-oracle`, frozen base `04db5d7`, candidate PR #241 at `f3c80e2`.

## Current route

```text
frozen base / 04db5d7 ← PR #241 / f3c80e2 F-01 oracle ← correction round 1 / 7d34c50 ← maintainer decision required
```

- Strategy: `single-pr`; frozen candidate measured 379 authored additions plus deletions, within the hard 400-line limit.
- Boundary: admission test, dedicated stdio oracle, and package commands travel together with their verification; CI currently reaches the oracle indirectly through `test:mcp`.
- Start: approved F-01 proposal/spec/design/tasks and passing 43-test safety net.
- Finish: truthful RED retained twice unchanged, complete GREEN oracle, strict 6/12 verification, independent dual judgment, archive, and delivery.
- Rollback: remove `scripts/json-toon-contract.mjs`, `test/json-toon-contract-admission.test.ts`, `test:mcp-formats` from `package.json`, and its `.github/workflows/ci.yml` line.
- Out of scope: universal `outputSchema`, #103, R-01/recovery, UI, Code Mode, apply/mutation, Harness edits, and production changes without witnessed failure.

## Judgment Day round-1 scoped re-judgment

Correction HEAD `7d34c50` produced an explicit contradiction. Judge A `ESCALATED` after seven executable dead-branch/short-circuit control-flow bypasses were accepted by lexical AST admission, with one judge-local SEVERE and one stale-provenance INFO. Judge B `APPROVED` after 16/16 direct mutations were rejected twice, with zero correction-caused findings. Both results remain recorded without either refuting the other.

F01-JD-C01 closure is disputed. Task 4.2 remains pending, candidate status is `maintainer-decision-required`, and `resolve-review` is next. There is no terminal approval and no fix authority because the severe is not confirmed by both scoped judges.

One of two correction rounds remains, but it cannot be used unless a maintainer explicitly adjudicates and authorizes a scoped second-round objective consistent with Judgment Day rules. Permitted options are: (1) authorize behavioral mutation execution rather than lexical presence, forecast likely ≤240 changed lines and hard limit 400; (2) adjudicate F01-JD-C01 closed from Judge B's evidence while preserving Judge A's contrary result; or (3) leave closure disputed and stop without approval or further correction. Every option preserves the no-production/no-Harness boundary.

## Budget contingency

If a correction reforecast or measured correction changes exceed 400, stop before further edits and switch under `auto-chain` to:

```text
PR #241 / f3c80e2 ← correction U1a admission authority ← correction U1b conditional hash/CI assertions
```

Each child must be ≤400 lines, independently verified, reviewable in about 60 minutes, based on its immediate predecessor, and show only its own diff. No `size:exception` is planned.

## Harness routing

The roadmap requires registered stdio MCP evidence, so a pinned Harness run is currently `N/A`. Only a later explicit roadmap requirement may add a read-only check against revision `cd5ef8148158c3a752a658978873241fdf8e2bbc`; it must prove apply absent and must not modify the checkout.
