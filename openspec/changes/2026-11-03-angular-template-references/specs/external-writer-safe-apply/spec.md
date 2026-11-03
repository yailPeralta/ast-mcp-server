# External Writer Safe Apply Delta

## MODIFIED Requirements

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
