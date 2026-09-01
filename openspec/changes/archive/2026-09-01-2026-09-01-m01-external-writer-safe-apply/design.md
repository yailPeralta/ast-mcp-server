# Design: External-writer-safe apply publication

## Technical approach

Extract the filesystem protocol from `managed-file.ts` into `src/services/authenticated-publication.ts`. `operations.ts` adapts prepared bytes/hash/mode while preserving sequential apply, receipts/replay, locks, diagnostics, cancellation, persisted plans, and success responses.

## Architecture decisions

| Decision           | Choice and rationale                                                                                                                                                                                                                                                                                                                            | Rejected alternatives / consequences                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Internal boundary  | `authenticated-publication.ts` owns held descriptors, coreutils, authentication, cleanup, and rollback. `managed-file.ts` keeps setup directory/status/result policy; `operations.ts` adapts structural plans.                                                                                                                                  | Direct reuse leaks setup semantics; duplication drifts. Extraction creates one authority.         |
| State model        | `PublicationResult = pre_effect \| committed \| rolled_back \| ambiguous`, discriminated as `{state:"pre_effect", reason:"conflict"\|"unsupported"}`, `{state:"committed", token:CommitToken}`, `{state:"rolled_back", reason:"conflict"}`, or `{state:"ambiguous", phase:"commit"\|"rollback"}`. Tokens hold ephemeral identities/hashes only. | Booleans cannot express ownership; inode data stays out of persisted hash-bound plans.            |
| Public mapping     | `pre_effect/conflict` or `rolled_back` → `CONFLICT`; unsupported → `MUTATION_BLOCKED`; ambiguous → fixed `AMBIGUOUS_APPLY`; all committed → existing success/receipt. Proved rollback preserves non-race typed errors.                                                                                                                          | Regex classification is fragile; adapters throw bounded, path/byte-free `PublicOperationalError`. |
| Platform authority | Probe each destination filesystem with owned sibling entries and actual link/exchange/no-replace primitives before source effects.                                                                                                                                                                                                              | No `rename`, copy/delete, or lock fallback; unsupported capability fails closed.                  |

## Interfaces and data flow

```ts
publishAuthenticated(plan, driver): Promise<PublicationResult>
rollbackOwnedCommit(token, original): Promise<PublicationResult>
probePublicationCapability(parent): Promise<void>
```

`plan` carries destination, expected absence or `{sha256, mode}`, and postimage bytes/hash/mode, without setup concepts.

```text
validate plan/workspace → probe filesystems → stage all files
  → for each sorted file: authenticate parent + preimage → publish → authenticate result
  → sync directories → mark applied → persist receipt
  ↘ failure: reverse rollback committed tokens → owned/ambiguous terminal result
```

For each file, open the parent with `O_DIRECTORY|O_NOFOLLOW` and retain it; create, chmod, fsync, retain, and authenticate the sibling stage. For replacement, retain the destination preimage and verify stable identity, hash, and mode. Creation links the held stage through `/proc/self/fd` with `ln -L -T`; any different destination is no-effect conflict. Replacement executes `mv --exchange --no-copy -T`, then authenticates destination=stage, temporary=exact preimage and rereads the held preimage. Destination substitution and same-inode content/mode edits trigger exchange-back only after exact-pair revalidation: proved restoration is `rolled_back`; changed/missing pair is `ambiguous` and stops destructive recovery.

Timeout, spawn error, nonzero exit, or signal settles only on child `close`; identities, not exit status, decide outcome. Pre-effect filesystem denial is unsupported; unproved post-effect state is ambiguous.

`applyOperation` enters completion-critical before the first source link/exchange and defers cancellation until a terminal state. Earlier commits roll back in reverse only when `CommitToken` proves the exact AST postimage. Replacement stages original bytes through the same protocol; creation uses authenticated extraction/no-replace cleanup, never pathname-only unlink. Lost proof preserves entries and returns ambiguity. Semantics remain sequential, not globally atomic. Receipt failure and exact-postimage replay retain current behavior without repeating mutation.

## Test-only seams and RED/GREEN matrix

Replace `beforeReplace/afterReplace` with `onFilePhase({operationId,file,index,phase})`, where phase is `capability-preflight | before-publish | after-commit | before-rollback`; keep compatibility only inside tests during migration. Promise barriers provide deterministic ordering.

| RED before implementation; GREEN after                             | Expected result                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| replacement substitution and same-inode bytes/mode edit            | exact-pair rollback, `CONFLICT`, external state current               |
| distinct configs share one inode                                   | later committed writer remains current                                |
| file 0 committed; file 1 conflicts; file 0 changed before rollback | owned rollback only; otherwise `AMBIGUOUS_APPLY`                      |
| creation competitor after absence check                            | no clobber, stage unpublished, `CONFLICT`                             |
| timeout/signal with unchanged, committed, and unproved identities  | blocked/conflict, committed classification, or ambiguity respectively |
| injected unsupported filesystem capability                         | zero source effects, `MUTATION_BLOCKED`                               |

Keep receipt/replay, scheduler, cancellation, and scaffold rollback green. Primitive parity stays in `managed-guidance.test.ts`; operation behavior in `operations.test.ts`.

## File changes

| File                                                                           | Action                                |
| ------------------------------------------------------------------------------ | ------------------------------------- |
| `src/services/authenticated-publication.ts`                                    | Create generic protocol.              |
| `src/services/managed-file.ts`                                                 | Adapt setup policy.                   |
| `src/services/operations.ts`                                                   | Add adapter, tokens, hooks, rollback. |
| `src/services/public-errors.ts`                                                | Add typed mapping.                    |
| `test/operations.test.ts`, `test/managed-guidance.test.ts`                     | Add races/parity.                     |
| `docs/support.md`, `README.md`, `docs/adr/0001-secure-yarn-and-agent-setup.md` | Align support wording.                |

## Threat matrix

| Prescribed boundary      | Applicability / planned RED           |
| ------------------------ | ------------------------------------- |
| Documentation-like paths | N/A — classification unchanged; none. |
| Git repository selection | N/A — no Git invocation; none.        |
| Commit state             | N/A — no Git index; none.             |
| Push state               | N/A — no push; none.                  |
| PR commands              | N/A — no PR automation; none.         |

The subprocess boundary uses fixed executable/argv/env, no shell, bounded stderr/time, close settlement, probes, and identity-derived outcomes.

## Rollout, compatibility, and work units

No migration or flag. Harness keeps `AST_MCP_APPLY_GUARD=deny`; unverified targets remain unsupported. Auto-chain above 400 authored lines: (1) hooks+REDs; (2) primitive, managed-file parity, creation/replacement GREEN; (3) rollback/mapping, receipts, docs, full gates. Each unit includes tests and independent revert. Gates: format, lint, typecheck, tests, build, and supported-Linux capability/package smokes.

## Open questions

None.
