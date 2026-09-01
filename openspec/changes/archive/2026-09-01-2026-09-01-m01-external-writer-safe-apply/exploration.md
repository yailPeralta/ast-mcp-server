## Exploration: External-writer-safe apply publication

### Current State

Issue [#127](https://github.com/yailPeralta/ast-mcp-server/issues/127) is approved and matches roadmap finding M-01. The supported mutation target is Linux x64 with the repository's verified GNU/coreutils and procfs primitives. DeepSeek Harness apply remains absent and denied.

#### Exact publication window

`src/services/operations.ts::applyOperation()` currently performs these steps under scheduler, in-process write queue, and filesystem lock keys derived from the canonical `tsconfig.json` path:

1. recompute the complete workspace hash;
2. verify every replacement preimage by reading and hashing its pathname;
3. stage every postimage in a sibling temporary file and close its descriptor;
4. verify every replacement preimage again at lines 889–906;
5. invoke `beforeReplace(file, index)`;
6. publish a creation with `link(stagedPath, destinationPath)`, or a replacement with `rename(stagedPath, destinationPath)`;
7. verify the destination postimage by pathname.

The M-01 window is therefore exactly between the last pathname read/hash at lines 899–905 and the destructive replacement rename at line 921. `beforeReplace` at line 909 is already inside that window. An editor or another configuration can replace or edit the target after authentication; `rename()` then discards that new directory entry without returning the displaced inode, so neither post-write verification nor rollback can identify whose bytes were displaced.

Creation differs from replacement. POSIX hard-link creation is already destination-no-clobber: if another writer creates the destination first, `link()` fails and preserves that file. However, the staged descriptor is closed before publication and publication is pathname-based, so creation does not yet reuse the repository's stronger held-descriptor and authenticated-parent pattern. Replacement is the proven destructive defect.

#### Locks and overlapping configurations

- `withProjectOperation()`, `withWriteLock()`, and `withWorkspaceFileLock()` all serialize by resolved configuration identity.
- Two distinct config files that include one physical source file receive different scheduler sessions, write queues, and lock filenames.
- Consequently, both applies can pass final authentication of the shared file. The later pathname rename can silently replace the earlier apply's postimage.
- A lock keyed by physical file identity could reduce collisions between cooperating AST processes, but it would not protect against editors or arbitrary writers and would add multi-file lock ordering/deadlock concerns. It cannot be the M-01 authority primitive.

#### Multi-file and rollback behavior

Files are published sequentially in deterministic `file` order; there is no global filesystem transaction. Once the first source write starts, cancellation is intentionally deferred until the operation reaches a consistent terminal state.

On failure, current rollback walks already-applied files in reverse. It first checks that current bytes hash to the AST postimage, then:

- removes a created file by pathname; or
- recreates original bytes in a sibling restore file and destructively renames it over the destination.

The initial postimage hash check prevents some stale rollback, as demonstrated by the scaffold test that preserves a changed destination. It still has another check-to-rename window: a third party can write after the hash check and before `restoreFile()` renames. Rollback can therefore overwrite bytes it did not authenticate atomically.

For a multi-file race between publications, current code can overwrite a competitor on the next target and then report success. If a later failure occurs, prior targets are restored independently; any target changed before its rollback hash check is preserved, but a write after that check remains vulnerable. This change must preserve sequential per-file semantics and honest partial/ambiguous outcomes rather than claim a global transaction.

#### Existing stronger repository primitive

`src/services/managed-file.ts` already implements the relevant Linux pattern for setup-managed files:

- parent directories are opened with `O_DIRECTORY | O_NOFOLLOW` and traversed through `/proc/self/fd`;
- existing preimages and staged files remain open and are authenticated by device/inode, mode, metadata stability, and SHA-256;
- creation uses `ln -L -T` from a held staged descriptor to an authenticated directory, providing no-clobber publication;
- replacement uses GNU `mv --exchange --no-copy -T` on two entries in the same authenticated directory;
- after exchange, both sides are identified: the destination must be the staged inode and the temporary name must be the exact preimage inode;
- the displaced preimage is reread through its held descriptor and compared with the planned digest/mode;
- any substitution or same-inode content/mode edit triggers rollback only after the exact exchanged pair is revalidated;
- cleanup removes only authenticated owned entries and checks link counts;
- child timeout/failure waits for `close`, then filesystem identities determine `committed`, `possibly_committed`, or rolled-back state.

This is an atomic authenticate-after-displacement protocol: exchange obtains custody of the displaced entry without destroying it, then exact identity and bytes decide whether the commit is valid. If a concurrent writer substituted the destination, exact-pair exchange rollback returns that writer's inode and bytes to the destination. If a writer edited the same inode, rereading the held displaced descriptor detects it and rollback returns those edited bytes.

The checkout's `/usr/bin/mv` reports GNU coreutils 9.7 with `--exchange`, `--no-copy`, and `-T`. The repository also hard-codes `/usr/bin/ln`; on this host it reports uutils coreutils 0.8.0 rather than GNU, despite accepting `-L -T`. Therefore support must be based on the governed release environment and executable behavior, not inferred from this developer host's banner. Existing CI explicitly probes GNU `mv` 9.7 no-replace behavior, while managed-file tests exercise exchange/link races.

#### Test coverage and deterministic seams

`test/operations.test.ts` already uses promise barriers through `setOperationTestHooksForTests()`; no sleep is needed:

- `beforeReplace` is exactly after final preimage authentication and before publication;
- `afterReplace(index = 0)` is exactly between the first and second multi-file publication;
- existing tests already prove scheduler serialization, cancellation deferral, injected mid-apply rollback, receipt recovery, creation no-clobber, and preservation of a post-create competitor.

`test/managed-guidance.test.ts` provides reusable behavioral models for destination substitution, same-inode content/mode edits, exact-pair rollback, rollback-pair substitution, held-temp publication, and no-clobber creation.

The current hook payload lacks `operation_id` and publication phase. Counting calls can coordinate two configurations, but a minimally richer internal-only seam would make RED evidence unambiguous:

- `beforeFilePublish({ operationId, file, index, kind })` after final per-file authentication;
- `afterFileCommit({ operationId, file, index })` after authenticated per-file commit;
- `beforeOwnedRollback({ operationId, file, index })` before rollback authentication/publication.

These hooks must remain test-only, deterministic barriers and must not become public coordination APIs.

### Affected Areas

- `src/services/operations.ts` — replace pathname publication and pathname rollback with authenticated per-file publication while preserving prepare, diagnostics, scheduler, completion-critical, receipts, and replay behavior.
- `src/services/managed-file.ts` — likely reuse/extract the already-proven descriptor/exchange/link engine; avoid creating a second subtly different implementation.
- `src/services/public-errors.ts` — classify a proved competitor/unsupported mutation as bounded fail-closed evidence and reserve `AMBIGUOUS_APPLY` for outcomes whose ownership cannot be proven.
- `test/operations.test.ts` — add synchronized RED/GREEN cases for the final-check race, overlapping config identities, multi-file interleaving, creation, and ownership-aware rollback.
- `test/managed-guidance.test.ts` or a focused shared primitive test — retain parity for exchange/link capability and exact-pair recovery if primitives are extracted.
- `docs/support.md`, `README.md`, and the managed structural editing ADR — proposal/design should keep their Linux x64 support wording aligned; implementation should not claim NFS, macOS, Windows, or other filesystems without evidence.

### Approaches

1. **Reuse the managed-file authenticated exchange/link protocol** — adapt or extract its per-file publication engine for structural operations, with ephemeral apply-time snapshots bound to the prepared hashes/modes.
   - Pros: already implemented and race-tested; atomically retains the displaced inode; detects pathname substitution and same-inode edits; has exact-pair rollback and owned cleanup; preserves external bytes; uses already-declared Linux/GNU/procfs support.
   - Cons: structural operations need a careful adapter for existing plan records, multi-file receipts, and typed errors; wholesale reuse without narrowing could import setup-specific result semantics; likely exceeds one 400-line PR if tests and extraction are combined.
   - Effort: Medium.

2. **Call `renameat2(RENAME_EXCHANGE)` directly through a native addon/FFI** — expose a small kernel primitive and keep authentication in TypeScript.
   - Pros: no child-process outcome ambiguity; direct syscall semantics; potentially smaller runtime path.
   - Cons: Node has no built-in API; introduces native build/distribution and ABI/architecture work; broadens the release matrix; duplicates the already-governed GNU path; cannot be called portable without new evidence.
   - Effort: High.

3. **Add physical-file locks (`flock`, lockfiles, or inode-keyed queues)** — serialize AST participants across configuration identities.
   - Pros: can prevent two cooperating AST applies from racing; comparatively simple for one file.
   - Cons: editors and generators do not honor the lock; inode identity changes on replacement; multi-file lock ordering is required; it does not atomically authenticate displaced bytes and therefore does not satisfy issue #127.
   - Effort: Medium, but insufficient alone.

4. **Keep pathname rename with another precheck, hard-link backup, or post-rename hash** — add checks around the existing replacement.
   - Pros: small patch; portable Node APIs.
   - Cons: every precheck leaves the same TOCTOU window; a backup link captures an earlier inode but does not prove which inode `rename()` displaced; post-verification occurs after external bytes may already be lost; rollback remains pathname-racy.
   - Effort: Low, but rejected.

5. **Stage a whole directory/tree and swap it globally** — publish all files as one tree transaction.
   - Pros: could offer a stronger global commit model in constrained layouts.
   - Cons: incompatible with arbitrary project layouts and open files; crosses filesystems/directories; expands into the explicitly excluded global multi-file transaction.
   - Effort: High and out of scope.

### Recommendation

Use approach 1, but keep the M-01 contract smaller than the setup subsystem:

1. Preserve prepared operation bytes, hashes, modes, plan hash, diagnostics, scheduler admission, completion-critical behavior, and receipts.
2. Immediately before each file commit, open/authenticate the destination and sibling directory through no-follow descriptors and require the apply-time state to match the prepared preimage hash/mode and existing safety checks.
3. Keep the staged inode open and verify its exact bytes/mode/identity.
4. For creation, publish by descriptor-bound no-clobber link. `EEXIST` or any nonmatching destination is a conflict; never remove the competitor.
5. For replacement, atomically exchange staged and destination entries with `mv --exchange --no-copy -T`; validate both exchanged identities and reread the displaced held preimage. Commit only when it is exactly the authenticated planned preimage.
6. On a detected race, exchange back only after revalidating the exact pair. If either side changed, preserve both observable entries, classify the result as ambiguous/possibly committed, and require fresh inspection/replan.
7. For later multi-file failure, rollback each earlier file in reverse only when the current destination is the exact authenticated AST postimage. Restore prepared original bytes through the same authenticated exchange protocol. A third-party postimage is preserved and makes rollback incomplete/ambiguous; it is never overwritten.
8. Keep global multi-file atomicity explicitly unsupported. A failure may leave operation-owned committed files when ownership-safe rollback is impossible, and the bounded receipt/error must say so without paths or bytes.
9. Fail closed on any platform or filesystem lacking the verified primitive. Do not fall back to `rename()`, copy/delete, or pathname-only rollback. The truthful portable contract is rejection outside the verified Linux x64 + required primitive matrix, not an unproved cross-platform mutation claim.

The structural plan need not persist prepare-time inode numbers to close M-01: apply may capture an ephemeral destination snapshot immediately before commit, provided it proves the captured bytes/mode equal the hash-bound prepared preimage and then atomically authenticates that exact displaced inode. This avoids changing persisted operation schema solely for volatile inode identity. Any refactor should still bind directory/staged identities for the duration of publication.

#### Minimum public outcome contract

- **Competitor detected, zero source commit or exact-pair rollback proved:** fail with bounded `CONFLICT`; external bytes remain current.
- **Primitive/platform/filesystem unsupported before commit:** fail with bounded `MUTATION_BLOCKED` (or one explicitly specified equivalent); no source destination is changed.
- **Exact AST postimages committed but receipt persistence fails:** retain the existing recoverable postimage/receipt retry contract.
- **Commit or rollback ownership cannot be proven:** fail with `AMBIGUOUS_APPLY`; do not perform further destructive recovery; retain bounded operation/receipt evidence for inspection and fresh replan.
- **Success:** every affected destination is the authenticated staged inode/postimage; replay still requires exact recorded postimages.

No new successful-response fields are necessary for the minimum correction. Typed internal commit/rollback state is useful, but public errors should stay bounded and path/byte-free.

#### Deterministic RED matrix

1. **Final-check replacement race:** pause operation A at `beforeFilePublish`; write external bytes to its target; release A. Current code loses the external bytes. Corrected code fails `CONFLICT` and leaves those bytes current.
2. **Overlapping configurations:** create `tsconfig.a.json` and `tsconfig.b.json` in one fixture, both including the same physical source. Prepare A and B from one preimage. Pause A before publish, let B commit through its distinct config lock, then release A. Current A can overwrite B. Corrected A detects/displaces B only transiently, rolls the exact pair back, and leaves B current.
3. **Multi-file interleaving:** pause a rename after file 0 commits; externally change file 1 (and optionally file 0 to prove rollback ownership); release. Current code overwrites file 1. Corrected code preserves file 1, fails closed, and restores file 0 only if its exact AST postimage is still owned.
4. **Creation race:** pause after final absence authentication; create the target externally; release. Both current and corrected behavior must preserve the external file, while corrected behavior additionally proves the held staged inode was never published.
5. **Rollback race:** trigger a later-file failure, then alter an earlier committed destination at `beforeOwnedRollback`. Corrected rollback must not restore stale original bytes over the external postimage and must return incomplete/ambiguous evidence.
6. **Unsupported primitive:** inject a deterministic exchange/link capability failure before commit. Assert zero source mutations and bounded non-`INTERNAL_ERROR` classification, without relying on host timing or real primitive absence.

Each test uses deferred promises/counters and explicit hook arrival/release. No `setTimeout`, polling, or scheduler sleeps are required.

#### Review-sized delivery

With `auto-chain` and the normal 400-line budget, avoid one combined extraction/test/docs patch. A likely review sequence is:

1. deterministic REDs plus narrowly improved internal hooks;
2. shared authenticated publication primitive/adaptor and replacement/creation GREEN;
3. ownership-safe multi-file rollback, public classification, and focused support documentation.

The exact slices belong in later design/tasks, but exploration indicates a single PR is likely a medium/high budget risk.

### Risks

- GNU `mv --exchange` availability is not equivalent to filesystem support; the operation must classify actual identity outcomes and fail closed without assuming an error means no commit.
- Child timeout/signal handling can create ambiguous outcomes unless definitive process close and post-state identity inspection remain mandatory.
- Importing setup-specific managed-file behavior wholesale could accidentally change structural operation plans, modes, path policy, receipts, or replay semantics.
- Existing public legacy message matching would classify many new generic primitive errors as `INTERNAL_ERROR`; typed wrapping is needed at the structural apply boundary.
- Physical-file locks may be tempting but cannot substitute for atomic displaced-preimage authentication.
- No guarantee should be stated for NFS, macOS, Windows, other Linux architectures, or filesystems not covered by the mutation matrix.
- The local host's `/usr/bin/ln` is not GNU even though repository support text names GNU `ln`; release verification must authenticate or behavior-probe the executable actually used.

### Ready for Proposal

Yes. The proposal should require authenticated per-file exchange/no-clobber publication, exact-ownership rollback, deterministic barrier-based REDs, and bounded fail-closed outcomes on the verified Linux target. It should explicitly preserve Harness apply denial and exclude M-02, R-01, F-01, global multi-file transactions, and arbitrary-process coordination.
