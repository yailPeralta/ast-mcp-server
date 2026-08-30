# Harness lifecycle ownership specification

## ADDED Requirements

### Requirement: Pinned identity gates lifecycle state

The gate MUST authenticate the pinned host/tag/CLI, bridge package/source, AST candidate/tarball/entrypoint, adapter/config, Node/executable, profile, Agent/Session, Web, Playwright, and Chromium before fixture or lifecycle state; absence or drift MUST be `BLOCKED`.

#### Scenario: Complete identity admits lifecycle work

- **GIVEN** every pinned identity matches, **WHEN** preflight completes, **THEN** the tuple MAY admit lifecycle state.

#### Scenario: Identity drift blocks before state

- **GIVEN** any identity is absent or mismatched, **WHEN** preflight runs, **THEN** `BLOCKED` MUST precede fixture/lifecycle state.

### Requirement: Catalog transitions converge deterministically

Convergence MUST await boundary completion, expected Session catalog/owner state, and no unsettled same-generation event; sleeps MUST NOT prove it and deadline expiry MUST fail.

#### Scenario: Cordis removal converges to zero

- **GIVEN** 15 unique AST schemas, **WHEN** config-HMR removal converges, **THEN** zero AST schemas and no retired owner remain, and stale invocation/late result MUST be rejected.

#### Scenario: Reconnect publishes once

- **GIVEN** converged removal, **WHEN** re-enable converges, **THEN** one fresh schema-identical 15-tool catalog MUST appear without duplicate schema, listener, terminal, or durable evidence.

### Requirement: User cancellation retains AST terminal authority

User cancellation MUST yield one bounded correlated AST error from the closed vocabulary; bridge Abort acknowledgement MUST remain separate transport evidence.

#### Scenario: Session cancellation is correlated

- **GIVEN** a held Session AST call, **WHEN** public user-cancel occurs, **THEN** one `REQUEST_CANCELLED`, native `tools/result`, and durable `tool/result` MUST exist with one UUID and at most 4096 response bytes.

#### Scenario: Competing abort classification fails

- **GIVEN** bridge Abort acknowledgement, **WHEN** terminal evidence is classified, **THEN** generic abort/timeout, duplicate, uncorrelated, unbounded, or sensitive evidence MUST fail AST ownership.

### Requirement: Retirement and shutdown leave no effects

Retired work MUST NOT publish success, another terminal, durable output, or registration; shutdown MUST leave no process, profile, socket, lock, listener, timer, fixture hold, or temporary residue.

#### Scenario: Retired generation settles late

- **GIVEN** HMR retires a generation with an admitted call, **WHEN** late producers settle, **THEN** no retired effect MAY publish and only a fresh generation MAY publish.

#### Scenario: Host shutdown is complete

- **GIVEN** an admitted call and warm worker, **WHEN** shutdown converges, **THEN** admission MUST close with bounded correlated terminal evidence and every residue category MUST be absent.

### Requirement: GUI evidence is rendered pinned state

GUI proof MUST read pinned Trajectory → Tools rows correlated to each durable `request/header` and lifecycle boundary; MCP, registry, config, probe, or durable data MUST NOT substitute.

#### Scenario: Rendered lifecycle sequence

- **GIVEN** headers around enable/removal/re-enable, **WHEN** each Tools view opens, **THEN** unique AST rows MUST be `15 → 0 → 15` and final schemas MUST match baseline.

#### Scenario: GUI witness is unavailable or indirect

- **GIVEN** rows cannot be inspected or correlated, **WHEN** GUI evidence is judged, **THEN** failure or `BLOCKED` MUST replace skip or indirect pass.

### Requirement: Predecessor and surface invariants remain mandatory

The gate MUST preserve H-01a/H-02/H-03, apply denial, and guarded-15-tool/no-public-fixture invariants without compatibility downgrade.

#### Scenario: Combined gate passes

- **GIVEN** every lifecycle scenario converges, **WHEN** the candidate is accepted, **THEN** all preserved assertions MUST pass.

#### Scenario: Preserved invariant regresses

- **GIVEN** any preserved assertion fails, **WHEN** lifecycle evidence otherwise succeeds, **THEN** the combined gate MUST fail.
