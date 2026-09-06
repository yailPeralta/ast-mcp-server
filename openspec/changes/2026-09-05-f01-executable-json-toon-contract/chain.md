# F-01 Delivery Route

Authority: issue #235 (`status:approved`, `type:chore`), branch `test/f01-json-toon-oracle`, frozen base `04db5d7`, candidate PR #241 at `f3c80e2`.

## Current route

```text
frozen base / 04db5d7 ← PR #241 / f3c80e2 F-01 oracle ← correction round 1 / 7d34c50 ← PR #244 base 09376d1 ← correction round 2 working tree
```

- Strategy: `single-pr`; frozen candidate measured 379 authored additions plus deletions, within the hard 400-line limit.
- Boundary: admission test, dedicated stdio oracle, and package commands travel together with their verification; CI currently reaches the oracle indirectly through `test:mcp`.
- Start: approved F-01 proposal/spec/design/tasks and passing 43-test safety net.
- Finish: truthful RED retained twice unchanged, complete GREEN oracle, strict 6/12 verification, independent dual judgment, archive, and delivery.
- Rollback: remove `scripts/json-toon-contract.mjs`, `test/json-toon-contract-admission.test.ts`, `test:mcp-formats` from `package.json`, and its `.github/workflows/ci.yml` line.
- Out of scope: universal `outputSchema`, #103, R-01/recovery, UI, Code Mode, apply/mutation, Harness edits, and production changes without witnessed failure.

## Judgment Day correction round 2

The maintainer adjudicated Judge A's seven control-flow bypasses as within F01-JD-C01 and authorized the final correction round. The foreground correction on `fix/f01-behavioral-admission` adds shared executable checks plus seven independently enumerated deterministic-fault probes. RED reproduced all seven prior bypasses twice; GREEN rejected all 23 direct/probe mutations twice and retained stable two-run oracle evidence and `test:mcp` reachability.

Correction 2 is applied, not approved. Final blind dual re-judgment over the frozen ledger plus this delta is pending. Both correction rounds are consumed; any remaining defect escalates. Production, CI workflow, Harness, commit, push, PR, issue, and delivery authority remain untouched.

## Budget contingency

If a correction reforecast or measured correction changes exceed 400, stop before further edits and switch under `auto-chain` to:

```text
PR #241 / f3c80e2 ← correction U1a admission authority ← correction U1b conditional hash/CI assertions
```

Each child must be ≤400 lines, independently verified, reviewable in about 60 minutes, based on its immediate predecessor, and show only its own diff. No `size:exception` is planned.

## Harness routing

The roadmap requires registered stdio MCP evidence, so a pinned Harness run is currently `N/A`. Only a later explicit roadmap requirement may add a read-only check against revision `cd5ef8148158c3a752a658978873241fdf8e2bbc`; it must prove apply absent and must not modify the checkout.
