# Proposal: External-writer-safe apply publication

## Intent

Close M-01 from approved issue [#127](https://github.com/yailPeralta/ast-mcp-server/issues/127): pathname publication/rollback can destroy external bytes. Apply must authenticate the displaced entry and fail closed when ownership is unproved.

## Observable fail-closed behavior

- Creation links a held staged inode without clobbering; a competing entry remains current and yields bounded `CONFLICT`.
- Replacement exchanges staged/destination entries, then authenticates both identities and the displaced preimage. Roll exchange back only while the exact pair remains owned; otherwise return `AMBIGUOUS_APPLY` without destructive recovery.
- Unsupported required capability yields `MUTATION_BLOCKED` before mutation; never fall back to pathname rename.
- Multi-file commits stay deterministic and sequential. Reverse rollback restores only exact AST postimages; third-party postimages remain and make the outcome incomplete/ambiguous.

## Scope

### In scope

- Reuse managed-file descriptor/authenticated-parent link/exchange primitives.
- Cover creation, replacement, overlapping configurations sharing a file, multi-file interleaving, and rollback ownership.

### Out of scope

- Global multi-file transactions, arbitrary-writer coordination, or locks as authority.
- Claims beyond verified Linux x64 plus governed procfs/coreutils/filesystem behavior.
- M-02, R-01, F-01, persisted plan expansion, or response additions.
- DeepSeek Harness apply authorization; apply remains absent and denied.

## Capabilities

### New capabilities

- `external-writer-safe-apply`: authenticated per-file publication, conflicts, sequential commit, and owned rollback.

### Modified capabilities

- None. Canonical read/index and Harness lifecycle requirements stay unchanged.

## Approach and affected areas

Adapt `src/services/managed-file.ts` primitives behind `src/services/operations.ts`; add classifications in `src/services/public-errors.ts`, barrier REDs in `test/operations.test.ts`, parity tests, and support wording.

## Deterministic RED matrix

| RED                 | Barrier and expected correction                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Replacement         | External write at `beforeFilePublish`; preserve it, `CONFLICT`.                                  |
| Overlapping configs | B commits shared file while A pauses; A cannot overwrite B.                                      |
| Multi-file          | After file 0, competitor changes file 1/file 0; preserve competitors, rollback owned state only. |
| Creation            | Competitor creates after absence check; no clobber/staged publication.                           |
| Rollback            | Change destination at `beforeOwnedRollback`; no stale restore, ambiguous evidence.               |
| Unsupported         | Inject pre-commit capability failure; zero mutations, `MUTATION_BLOCKED`.                        |

Use promise barriers/counters, never sleeps or polling.

## Preserved invariants

Prepared bytes/hashes/modes, plan hash, diagnostics, compiler authority, scheduler locks, cancellation deferral, completion-critical behavior, ordering, receipts/replay, bounded path/byte-free errors, and Harness denial remain intact.

## Risks and rollback

Post-effect failures require identity inspection; reuse could leak setup semantics. Delivery rollback reverts each slice. Runtime rollback restores exact owned pairs only; otherwise preserve entries and report ambiguity. Runtime modes remain unchanged.

## Auto-chain strategy and success

Within 400 changed lines per review: (1) hooks plus REDs; (2) shared adapter and creation/replacement GREEN; (3) owned rollback, classifications, docs. Each slice is testable/revertible. Success requires all REDs green, unchanged receipt/replay tests, bounded failures, and no unsupported success claim.
