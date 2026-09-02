# Edit-Aware Diagnostic Delta Specification

## Purpose

Protect plan authorization across edits by separating provable continuity from touched or uncertain diagnostics. Semantic identity, source mapping, unfiled causality, and publication are outside scope. Uncertainty MUST over-block, never authorize a new error.

## Requirements

### Requirement: Compiler-coordinate observations

File-backed observations MUST retain compiler `start` and `length` as zero-based UTF-16 units internally. Public diagnostic, delta, prepared, and persisted shapes MUST remain unchanged and MUST NOT expose edit context.

#### Scenario: Compatible observation

- GIVEN a compiler diagnostic with a span
- WHEN comparison returns its public value
- THEN mapping MUST use UTF-16 start/length while output retains only existing fields

### Requirement: Bounded deterministic edit context

Context MUST derive from exact before/after compiler text and support ordered, non-overlapping insertions, deletions, and replacements. Equal inputs MUST align identically. Work MUST be bounded with cancellation checkpoints. Exhaustion MUST mark the uncertain middle between unchanged prefix/suffix as changed; cancellation MUST remain typed terminal, never fallback.

#### Scenario: Multi-edit bound

- GIVEN disjoint insertion, deletion, and replacement edits, including a budget-exhausting input
- WHEN context is built repeatedly
- THEN normal mappings MUST remain identical and ordered, while exhaustion MUST make the uncertain middle touched

### Requirement: Unchanged-run continuity

A file-backed observation MAY cancel only equal code/category/file/message and length at its exact mapped unchanged span. Harmless line/column shifts MUST remain continuous. Duplicate matching MUST be stable, using source order only as final tie-break.

#### Scenario: Shifted duplicates

- GIVEN equal duplicates remain in unchanged runs after an earlier edit
- WHEN snapshots are compared repeatedly
- THEN each MUST map exactly and added/removed ordering MUST remain stable

### Requirement: Touched spans fail closed

Observations intersecting or touching either changed boundary MUST NOT cancel. This includes spans abutting a boundary and zero-width spans at insertion/deletion points. Missing `start` or `length` in an affected file MUST prevent cancellation.

#### Scenario: Boundary and missing-span matrix

- GIVEN intersecting, abutting, zero-width, or missing-span affected diagnostics
- WHEN equal textual observations exist across snapshots
- THEN after observations MUST be added and before observations MUST be removed

### Requirement: File and text edge cases

Created-file diagnostics MUST be added; future deleted-file diagnostics MUST be removed. Unchanged files MUST use deterministic textual multisets at identical available spans. Unfiled diagnostics MUST use deterministic legacy multisets including nullable location, without edit-aware claims. Compiler text governs coordinates: CRLF is two UTF-16 units; BOM bytes add no offset.

#### Scenario: Lifecycle and coordinates

- GIVEN created, deleted, unchanged, and unfiled cases in BOM-backed compiler text containing CRLF
- WHEN diagnostics are compared
- THEN lifecycle and unfiled rules MUST hold, CRLF MUST count twice, and BOM MUST not shift positions

### Requirement: Corrected preparation authority

Preparation MUST form exact changed-text pairs before its corrected delta, then compute policy, hash, and retention from it. It MUST write no sources. Existing cancellation, freshness, hash-binding, cleanup, and receipt invariants MUST hold.

#### Scenario: Dual-purpose RED

- GIVEN an edit replaces an in-body TS2322 with the same identity and harmlessly shifts an unrelated TS2322
- WHEN preparation defaults `allow_new_errors=false` and apply is attempted
- THEN exactly the replacement error MUST be added and block apply; the unrelated error MUST remain continuous and disk unchanged

### Requirement: Cutover and external compatibility

Old-comparator prepared plans MUST be rejected without authorization. Applied receipts MAY recover only after exact postimage verification. Public schemas and `allow_new_errors` meaning MUST remain compatible. Harness MUST keep 15 guarded tools, omit apply, and deny direct invocation without continuation.

#### Scenario: Persisted states

- GIVEN legacy prepared and applied records
- WHEN recovery is attempted
- THEN prepared MUST be denied; applied MAY replay only after exact postimage verification

#### Scenario: Harness denial

- GIVEN the shipped guarded Harness catalog
- WHEN tools are listed and direct apply is invoked
- THEN exactly 15 MUST appear without apply, and direct invocation MUST be denied
