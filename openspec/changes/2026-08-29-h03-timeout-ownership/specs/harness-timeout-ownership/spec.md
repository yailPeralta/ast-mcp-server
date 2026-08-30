# Harness Timeout Ownership Specification

## Purpose

Define timeout ordering and exact-host evidence that let AST, rather than the Harness bridge, own bounded slow-operation failures. This capability excludes H-05 lifecycle expansion, UI, Code Mode/PTC, apply, authorization, and output-vocabulary issue #103.

## Requirements

### Requirement: Published outer timeout exceeds the complete AST budget

The packaged Harness adapter MUST publish an external tool-call timeout satisfying `outer timeout > queue-wait budget + execution-deadline budget + explicit positive margin`. The margin and all three budget values MUST be machine-readable evidence; equality or an omitted/non-positive margin MUST fail validation.

#### Scenario: Shipped defaults have ordered ownership

- GIVEN AST's shipped 30-second queue-wait and 120-second execution-deadline budgets
- WHEN the packaged adapter timeout contract is inspected
- THEN its published outer timeout is strictly greater than 150 seconds plus its explicit positive margin

#### Scenario: Invalid ordering fails validation

- GIVEN any published timeout tuple with equality, insufficient headroom, or no positive margin
- WHEN the adapter contract is validated
- THEN validation fails before exact-host runtime evidence is accepted

### Requirement: Deterministic slow work reports an AST operational error

With deterministic slow work and compressed test-only budgets, the exact native Harness invocation MUST terminate with a bounded AST operational error identified by a stable class or code. It MUST NOT terminate as a generic bridge timeout, and validation MUST NOT depend on exact error prose.

#### Scenario: Compressed budgets preserve timeout ownership

- GIVEN compressed queue, execution, margin, and outer budgets that preserve the required strict ordering
- WHEN a deterministic fixture exceeds its applicable AST budget
- THEN the invocation returns the expected stable AST operational error class or code
- AND no generic bridge-timeout classification is observed

### Requirement: Slow-path evidence preserves cancellation, correlation, and cleanup

The exact-host evidence suite MUST cover cold, queued, and recycled-worker paths. For every path, evidence MUST correlate the originating invocation, AST cancellation, classified terminal error, and cleanup outcome without retaining owned processes or disposable profile, workspace, socket, lock, or other temporary state.

#### Scenario: Cold worker cancellation is complete

- GIVEN a slow invocation that begins through cold AST worker startup
- WHEN its AST budget expires
- THEN correlated evidence records cancellation and the classified AST terminal error
- AND cleanup readback finds no owned process or temporary state

#### Scenario: Queued work is cancelled without later execution

- GIVEN deterministic contention keeps a correlated invocation queued beyond its queue-wait budget
- WHEN AST rejects and cancels that invocation
- THEN the invocation never starts later and retains the same correlation in terminal evidence
- AND cleanup readback finds no owned process or temporary state

#### Scenario: Recycled-worker cancellation rejects stale generation effects

- GIVEN supervised execution deterministically crosses a worker recycle boundary
- WHEN the correlated slow invocation reaches its AST-owned terminal condition
- THEN cancellation and terminal evidence identify the owning invocation and worker generation
- AND no stale completion, owned process, or temporary state survives cleanup

### Requirement: Pinned identity drift blocks evidence

The gate MUST authenticate the declared immutable Harness host revision, bridge version/source revision, AST package candidate, adapter, and resolved runtime identities before slow fixtures run. Any missing value or mismatch MUST produce a blocked result and MUST NOT be reported as a skip or passing compatibility evidence.

#### Scenario: Exact identity permits execution

- GIVEN every required identity matches the change's pinned tuple
- WHEN the H-03 gate starts
- THEN slow-path evidence may execute and records the authenticated identities

#### Scenario: Identity drift blocks the gate

- GIVEN at least one required identity is missing or differs from the pinned tuple
- WHEN the H-03 gate starts
- THEN the result is blocked before slow fixtures execute
- AND no compatibility pass is emitted
