# F-01 Delivery Route

Authority: issue #235 (`status:approved`, `type:chore`), branch `test/f01-json-toon-oracle`, base PR #240 at `04db5d7`.

## Current route

```text
base PR #240 / 04db5d7 ← 📍 F-01 oracle work unit
```

- Strategy: `single-pr`; forecast 267–354 authored additions plus deletions.
- Boundary: admission test, dedicated stdio oracle, package command, and one CI invocation travel together with their verification.
- Start: approved F-01 proposal/spec/design/tasks and passing 43-test safety net.
- Finish: truthful RED retained twice unchanged, complete GREEN oracle, strict 6/12 verification, independent dual judgment, archive, and delivery.
- Rollback: remove `scripts/json-toon-contract.mjs`, `test/json-toon-contract-admission.test.ts`, `test:mcp-formats` from `package.json`, and its `.github/workflows/ci.yml` line.
- Out of scope: universal `outputSchema`, #103, R-01/recovery, UI, Code Mode, apply/mutation, Harness edits, and production changes without witnessed failure.

## Budget contingency

If pre-apply reforecast or measured authored changes exceed 400, stop before further edits and switch under `auto-chain` to:

```text
base PR #239 / eb85ee9 ← 📍 U1a admission + oracle ← U1b CI + closure
```

Each child must be ≤400 lines, independently verified, reviewable in about 60 minutes, based on its immediate predecessor, and show only its own diff. No `size:exception` is planned.

## Harness routing

The roadmap requires registered stdio MCP evidence, so a pinned Harness run is currently `N/A`. Only a later explicit roadmap requirement may add a read-only check against revision `cd5ef8148158c3a752a658978873241fdf8e2bbc`; it must prove apply absent and must not modify the checkout.
