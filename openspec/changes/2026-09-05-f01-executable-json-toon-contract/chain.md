# F-01 Delivery Route

Authority: issue #235 (`status:approved`, `type:chore`), branch `test/f01-json-toon-oracle`, frozen base `04db5d7`, candidate PR #241 at `f3c80e2`.

## Current route

```text
frozen base / 04db5d7 ← PR #241 / f3c80e2 F-01 oracle ← proposed correction child (consent required)
```

- Strategy: `single-pr`; frozen candidate measured 379 authored additions plus deletions, within the hard 400-line limit.
- Boundary: admission test, dedicated stdio oracle, and package commands travel together with their verification; CI currently reaches the oracle indirectly through `test:mcp`.
- Start: approved F-01 proposal/spec/design/tasks and passing 43-test safety net.
- Finish: truthful RED retained twice unchanged, complete GREEN oracle, strict 6/12 verification, independent dual judgment, archive, and delivery.
- Rollback: remove `scripts/json-toon-contract.mjs`, `test/json-toon-contract-admission.test.ts`, `test:mcp-formats` from `package.json`, and its `.github/workflows/ci.yml` line.
- Out of scope: universal `outputSchema`, #103, R-01/recovery, UI, Code Mode, apply/mutation, Harness edits, and production changes without witnessed failure.

## Judgment Day correction proposal

Round 1 is nonterminal `ESCALATED`: one dual-confirmed SEVERE completeness root violates SCN-004. Task 4.2 remains pending maintainer consent. If granted, create one correction child from PR #241 with forecast ≤220 and hard limit 400. Scope is independent hardcoded case/check expectations plus mutation tests for required-case substitution and executable canonical/equality/cleanup check removal. Add two-run hash comparison and CI reachability assertions only if the maintainer treats them as necessary to make that shared invariant executable. No production or Harness edits.

## Budget contingency

If a correction reforecast or measured correction changes exceed 400, stop before further edits and switch under `auto-chain` to:

```text
PR #241 / f3c80e2 ← correction U1a admission authority ← correction U1b conditional hash/CI assertions
```

Each child must be ≤400 lines, independently verified, reviewable in about 60 minutes, based on its immediate predecessor, and show only its own diff. No `size:exception` is planned.

## Harness routing

The roadmap requires registered stdio MCP evidence, so a pinned Harness run is currently `N/A`. Only a later explicit roadmap requirement may add a read-only check against revision `cd5ef8148158c3a752a658978873241fdf8e2bbc`; it must prove apply absent and must not modify the checkout.
