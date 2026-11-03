# External Writer Safe Apply Specification

## Purpose

Define authenticated publication and ownership-safe recovery for verified Linux x64.

## Requirements

### Requirement: Creation is held and no-clobber

Apply MUST publish held staged inodes without replacing destinations. Competitors MUST remain current and stages unpublished.

#### Scenario: Competitor wins creation

- GIVEN creation is paused after final absence authentication
- WHEN an external writer creates the destination before publication
- THEN apply fails with `CONFLICT`, preserves that entry, and publishes no staged inode

### Requirement: Replacement authenticates the displaced preimage

Replacement MUST atomically retain the displaced entry and authenticate its planned hash/mode/identity, committing only the staged postimage. Substituted or same-inode edited preimages MUST NOT be destroyed.

#### Scenario: External write follows final check

- GIVEN replacement pauses after final authentication
- WHEN an external writer changes the destination
- THEN exact-pair rollback returns `CONFLICT` and leaves external bytes current

#### Scenario: Distinct configurations share one file

- GIVEN distinct configurations prepare one physical file
- WHEN one commits while the other pauses
- THEN the paused apply MUST preserve it and return `CONFLICT` after exact-pair rollback

### Requirement: Multi-file apply is sequential, not globally atomic

Files MUST commit in deterministic order without global atomicity. Reverse rollback MUST restore only a proven exact operation-owned postimage, whether an AST postimage or a template-file postimage the compiler does not see.

#### Scenario: Later target conflicts

- GIVEN file zero committed and file one changed externally
- WHEN apply reaches file one
- THEN file one remains and file zero is restored only if its exact owned postimage is proven

#### Scenario: Owned rollback loses proof

- GIVEN rollback is paused before restoring an earlier commit
- WHEN an external writer changes either member of the owned pair
- THEN recovery performs no destructive overwrite and returns `AMBIGUOUS_APPLY` with the observable entries preserved

#### Scenario: Template file earlier in the sequence

- GIVEN an `.html` file committed before a later TypeScript file conflicts
- WHEN rollback runs
- THEN the `.html` is restored only if its exact operation-owned postimage is proven, otherwise `AMBIGUOUS_APPLY`

### Requirement: Outcomes distinguish effect and ownership

`CONFLICT` MUST mean zero source effect or proved exact-pair rollback. `MUTATION_BLOCKED` MUST mean pre-effect capability rejection. `AMBIGUOUS_APPLY` MUST mean post-effect commit or rollback is unproved; destructive recovery MUST stop. Errors MUST be bounded and path/byte-free.

#### Scenario: Required capability is unavailable

- GIVEN the verified link/exchange capability is absent, denied, or unsupported
- WHEN apply preflight runs
- THEN it returns `MUTATION_BLOCKED` with zero source mutations and MUST NOT fall back to rename, copy/delete, or pathname-only rollback

#### Scenario: Post-effect ownership is unknowable

- GIVEN publication may have occurred but commit or rollback is unproved
- WHEN classification runs
- THEN `AMBIGUOUS_APPLY` preserves evidence and requires inspection and fresh planning

### Requirement: Existing operation invariants remain authoritative

Apply MUST preserve hash-bound bytes/modes and plan, compiler freshness/diagnostics, scheduler admission, completion-critical ordering, receipts, replay, and cancellation. These invariants MUST extend to template files outside the compiler program: their per-file hash, workspace hash, mode, postimage ownership, rollback, and receipts are authoritative on the same terms.

#### Scenario: Receipt persistence fails after commit

- GIVEN every destination is the authenticated AST postimage
- WHEN receipt persistence fails
- THEN the recoverable receipt-retry contract remains authoritative and apply MUST NOT repeat source mutation

#### Scenario: Replay and cancellation

- GIVEN a recorded operation is replayed or cancellation arrives after first publication
- WHEN processing continues
- THEN replay requires exact recorded postimages, and cancellation is deferred until one consistent owned or ambiguous terminal result exists

#### Scenario: Template file in receipts and replay

- GIVEN an operation that edited an `.html` template
- WHEN the receipt is recorded and the operation is replayed
- THEN the template postimage is part of the receipt and replay requires its exact recorded bytes; the `.html` is handled as an ordinary planned file (same staging, publication, rollback, and import/export paths) without a new plan kind

#### Scenario: Diagnostics stay TypeScript-only

- GIVEN an operation that includes template edits
- WHEN post-apply diagnostics are computed
- THEN they cover TypeScript only and template errors are not claimed detected

### Requirement: Support and Harness boundaries remain closed

Mutation support MUST remain limited to the verified Linux x64 procfs/coreutils/filesystem matrix. DeepSeek Harness apply MUST remain absent and denied.

#### Scenario: Target or Harness lacks authority

- GIVEN an unverified target or a Harness apply request
- WHEN mutation is requested
- THEN no successful apply capability is exposed and no compatibility fallback is claimed

### Requirement: Race tests are deterministic

Tests MUST coordinate test-only seams by promise barriers, operation identity, file index, and phase; sleeps, polling, and timing MUST NOT prove safety.

#### Scenario: Barrier-controlled race

- GIVEN a test holds a named operation at a publication or owned-rollback barrier
- WHEN the competing write completes and the barrier releases
- THEN the test deterministically observes the required conflict, rollback, or ambiguity without sleeps
