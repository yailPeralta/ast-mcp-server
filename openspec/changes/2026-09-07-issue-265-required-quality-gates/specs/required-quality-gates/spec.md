# Required Quality Gates Specification

## Purpose

Define deterministic disposable package-manager authority and audit-safe resolution without weakening excluded behavior.

## Requirements

### Requirement: Private Corepack state

The smoke MUST place `COREPACK_HOME` beneath its disposable root, set `COREPACK_DEFAULT_TO_LATEST=0`, and set `COREPACK_ENABLE_AUTO_PIN=0` before profile installation.

#### Scenario: Closed Corepack environment

- GIVEN an adapter smoke
- WHEN authority is prepared
- THEN all controls are active before installation

### Requirement: Exact pnpm identity and integrity

Provisioning MUST select `pnpm@11.7.0` bound to SHA-512 hex `19cc852c120c7125760f2443ee6be0ca5b40f9f50598de1a09a1f177503e010e57c23c77646e01e761de59bf874fb22a3398c33ab9691fc13eb946b6f0f4d620` and MUST verify version `11.7.0` before installation.

#### Scenario: Identity admitted

- GIVEN a pnpm archive
- WHEN identity is checked
- THEN only the matching version and digest proceed

### Requirement: No ambient authority

Profile installation MUST NOT derive pnpm selection or package-manager cache authority from a global executable, user home, ambient Corepack cache, Known Good release, or latest registry release.

#### Scenario: Host state is ignored

- GIVEN conflicting host state
- WHEN a profile dependency installs
- THEN disposable exact authority remains selected

### Requirement: Bounded cleanup and repetition

Each run MUST remove its private package-manager state within the existing disposable-root teardown, including after failure, and a repeated run MUST recreate authority without prompts or prior-run dependence.

#### Scenario: Repeated isolated execution

- GIVEN a completed or failed run
- WHEN the smoke repeats
- THEN prior state is absent and the bounded lifecycle repeats

### Requirement: Fail-closed fallback launcher

If bundled Corepack cannot provide the exact private authority, the smoke MAY use a disposable PATH-first launcher for the same integrity-bound pnpm; it MUST preserve child exit and signal outcomes and MUST fail closed if exact launch cannot be established.

#### Scenario: Corepack incompatibility

- GIVEN Corepack cannot launch the pin
- WHEN fallback runs
- THEN the exact launcher succeeds or the smoke fails closed

### Requirement: Patched transitive resolutions

Yarn resolutions and lock data MUST resolve only `fast-uri@3.1.6` for `ajv` range `^3.0.1` and `qs@6.16.0` for `express` range `^6.14.0` and `body-parser` range `^6.15.2`.

#### Scenario: Parent ranges remain satisfied

- GIVEN the MCP dependency graph
- WHEN Yarn resolves affected transitives
- THEN exact patched versions satisfy all listed ranges

### Requirement: Immutable audit-safe graph

Yarn `4.15.0` MUST complete immutable installation, and the repository audit gate MUST exit zero without suppressions or exceptions.

#### Scenario: Clean immutable install and audit

- GIVEN committed dependency data
- WHEN install and audit run
- THEN both exit zero without lockfile mutation

### Requirement: Supported Node matrix

The quality-gate chain MUST pass on Node `22.13.0` and `24`, proving pnpm identity, smoke success, cleanup, immutable install, and configured audit.

#### Scenario: Both matrix cells pass

- GIVEN the unchanged matrix
- WHEN quality gates run
- THEN each cell preserves its gates and passes

### Requirement: Workflow topology preservation

The workflow MUST preserve matrix, gates, ordering, retry policy, and no package-manager caching; policy controls MUST pass.

#### Scenario: No CI weakening

- GIVEN established workflow policy
- WHEN the fix is checked
- THEN no gate is skipped, reordered, retried, cached, or suppressed

### Requirement: Harness and relationship exclusion

The change MUST NOT modify DeepSeek Harness, public APIs, MCP schemas, tool registration, or relationship, impact, and test-candidate semantics.

#### Scenario: Excluded surfaces remain unchanged

- GIVEN baseline exclusion controls
- WHEN the fix is applied
- THEN excluded sources and behaviors remain unchanged

### Requirement: Independent rollback

Rollback MUST remove private pnpm provisioning and tests together with both exact resolutions and lock entries, MUST NOT revert issue #247 work or alter Harness, and MUST occur only after a superseding gate fix exists.

#### Scenario: Safe work-unit rollback

- GIVEN a superseding fix
- WHEN this change is reverted
- THEN only this independent work unit is removed

## Traceability

- R1–R5: Scope, Approach, risks, and pnpm criterion.
- R6–R7: Resolution scope and audit criterion.
- R8–R10: Matrix criterion, exclusions, and compatibility.
- R11: Rollback and delivery boundary.
