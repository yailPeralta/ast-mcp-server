# Cold-install runtime separation verification

## Decision boundary

This change remediates failed GitHub Actions run `31547160641` for commit `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`. It authorizes no npm publication, dist-tag mutation, Git tag, or GitHub Release.

The predecessor commit and tree `c6a51f6949a302253a34d51b35ead930e585a640` remain immutable failed incident evidence. Every changed byte requires a successor exact-tree evidence chain.

## Incident evidence

The exact pushed run had two distinct outcomes:

- Node `22.5.0`: GNU `mv` preparation and `NODE_OPTIONS=` Corepack activation passed; first-attempt `NODE_OPTIONS= yarn install --immutable` failed during link with exit 42 and `unexpected empty event loop`.
- Node 24: dependency installation and every subsequent quality/release gate passed.

The failed Node 22.5 install had an explicitly empty `NODE_OPTIONS`, disproving the prior claim that the SQLite flag alone caused exit 42.

## Root-cause probes

All probes used fresh materializations of exact commit `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`:

- Yarn 4.15.0 under Node 22.5 failed first-attempt cold installation in 4 of 5 consecutive runs; no retry was counted as PASS.
- Yarn 4.18.0 under Node 22.5 failed at the same cold link boundary with exit 42, disproving a 4.15-only regression.
- Yarn 4.14.1 could not consume the immutable Yarn 4.15 lockfile because it would downgrade lockfile metadata; this is negative compatibility evidence only.
- Yarn 4.15.0 immutable installation under Node 24 followed by the complete test suite under Node 22.5 with `--experimental-sqlite` passed 529/529 across 43 files.

The Yarn CLI's own guard reports exit 42 when `beforeExit` fires while its unresolved main promise has no active event-loop resource. Separating the cold linker from the minimum product runtime avoids that package-manager scheduling defect without reducing Node 22.5 product coverage.

## Requirement traceability

| Requirement   | Implementation                                                                                           | Verification                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `COLD-CI-001` | Two position-bound setup-node actions and two isolated Corepack boundaries in `.github/workflows/ci.yml` | Workflow policy acceptance; cold Node 24 install + Node 22.5 full suite       |
| `COLD-CI-002` | Private detached exact-tree worktree per runtime in `scripts/release-candidate-matrix.mjs`               | Fresh-state unit regression plus first-attempt exact-tree matrix              |
| `COLD-CI-003` | Closed action/input and command sequence in `scripts/workflow-policy-check.mjs`                          | Adversarial topology mutations in `test/workflow-policy-check.test.ts`        |
| `COLD-CI-004` | New SDD and predecessor invalidation                                                                     | Fresh matrix, canaries, reviews, archive, commit, push, exact-SHA CI required |
| `COLD-CI-005` | No release workflow or registry transition                                                               | External boundary readback before closure                                     |

## Initial implementation gates

- RED: 5 focused failures at the new topology, install-authority, and freshness assertions.
- GREEN: focused workflow/matrix tests 26/26.
- format check: PASS.
- lint: PASS.
- typecheck: PASS.
- direct workflow policy: PASS, 3 workflows / 9 jobs / 24 pinned action invocations.
- `git diff --check`: PASS.

These gates preceded Review A remediation and no longer authorize later bytes. At that stage, the exact-tree matrix, four canaries, full gates, report hashes, Reviews A/B, archive readback, commit/push, and remote exact-SHA CI remained pending.

## Preliminary physical-matrix proof

Preliminary staged tree `8f73b92818a81c3ba753b9db56a5396715e27a26` exercised the completed runner itself before final freeze:

- Node 22.5: PASS 15/15 on a private cold worktree.
- Node 24: PASS 15/15 on a distinct private cold worktree.
- Both installs used Node `v24.16.0` with `NODE_OPTIONS` exactly empty.
- Both reports authenticated `cold_workspace: true`, workspace tree equal to the candidate tree, zero failed commands, and successful worktree cleanup.
- Report hashes: summary `c98341f510447609eef7982f402d0ee5824ca8b18be5ebe5f2ab6b546a22b4fe`; Node 22.5 `5d23c4d2b77c3385de0038f72c9dfdefe582aef44c654ca00a3a9a2f6bad7601`; Node 24 `53a7507d0db6da36cf60b2982fbc02b4470817a818a9e577326d73f716e26301`.

This tree is preliminary only: recording the result and completing failure-report provenance changed bytes. It is not review- or commit-authorized evidence.

## Pre-review exact-tree evidence bridge

Reconciled implementation tree `97109f3412a67236a777069b342674b9a4161036` was materialized as synthetic commit `9330fb487e8d04b83c3cf114e6b83abdaa09eebf`, with sole parent `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`.

Its fresh physical matrix passed 15/15 commands per runtime with no failed, timed-out, or signalled command. Each report authenticated a private cold workspace whose tree equalled `97109f3412a67236a777069b342674b9a4161036`; immutable installation used Node `v24.16.0` and empty `NODE_OPTIONS` before runtime-specific gates:

- summary: `7a3aee0a82e95a11bdd51d4ddbce1d098a95d4383d29a9b425e92051f458540e`;
- Node `v22.5.0`: `e276f02a666aecd87c0d9b13b84f1b1fc28fcdcd23a21a80fe0a1fb3b4525799`;
- Node `v24.16.0`: `6a663bdafd8834312c48b868c9b054b72f784ed8136d014d6e3be72120dbf952`.

Four candidate-bound canaries each passed 40/40 top-level gates, every nested deterministic-fixture gate was true, and each retained 20 iterations plus 3 restarts:

- `ast-mcp-server` / Node 24: `64ae9f647c1220f2e5e69a285a1480745f0720ccefebbbfbbf0a440f8503e9f0`;
- `ast-mcp-server` / Node 22.5: `4907ea5b86ad93e8f56c6023f4b2424cd83721831caa45905cc43a7b99b756a6`;
- `x-scraper` / Node 24: `0202cf5d996b97ec4554c565be0514079b068e785e617ce406aeb6ffd88da384`;
- `x-scraper` / Node 22.5: `cfc13070c7165bde1a335d4ebca392a5b5ad21ffd66d03f48329643c30349599`.

The physical `x-scraper` identity remained clean at commit `a86fffb15ad21912a87583c2d498f813c47aa27e`, tree `9c359690b58867e01750905b76b1c0cca3ad15a2`. The candidate index remained stable and the detached canary worktree was removed.

This durable reconciliation changes only SDD bytes and therefore creates a successor tree. Under the exact-tree policy, the successor must repeat the full matrix and four canaries before Review A; the hashes above remain an immutable evidence bridge, not authorization for the successor.

## Rejected Review A cohort

Tree `f62d5d7ed7abd696564aab54ae7026b86a74b8de` was materialized as synthetic commit `5a482764cfaad8068379e4b56375d92be3e64499` with sole parent `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`. Its fresh matrix passed 15/15 commands per runtime, and four candidate-bound canaries passed 40/40 with 20 iterations and 3 restarts:

- summary: `3bb353f47ff4dc553f5c8cccb91d34b59a5c62fa2aaefc7fa1f43b1ad6bbada1`;
- Node `v22.5.0`: `4f9e741954d2adb148d1494dc0be6b753ceaf81fd56148db937655ee3a84d9f6`;
- Node `v24.16.0`: `04a28227d5d3c374f4f6dcaaf8ca1ab7c94fc3674e6d6c266511086c9154800a`;
- `ast-mcp-server` / Node 24: `a695b1955dea8be69b701aaf4315d68a284bf39c3c4fbd0d3f068ec19ec2b482`;
- `ast-mcp-server` / Node 22.5: `cbce0947f9a3c355b0488cf72cd5b6d6f1f279027631f5c07e7006f534ddb346`;
- `x-scraper` / Node 24: `f65a9dd5d9ee9527271f2dfc42dbebed56aee87e93b3e5b4693ac2050cb62494`;
- `x-scraper` / Node 22.5: `dc397f1047987690b774b2f642c25f46b0ef7ad13a42a0654d87d1d747e9ae68`.

Review A rejected that exact tree. Security/workflow review reported High 1 and Medium 1: independently validated action and command subsequences permitted runtime-setup reordering, and package-manager installation inherited an ambient environment beyond empty `NODE_OPTIONS`. SDD/evidence review independently confirmed the interleaving defect and reported Medium gaps in direct fail-closed tests plus contradictory durable state. The quality review was incomplete because its session could not authenticate the Git object and therefore did not count as PASS.

The remediation binds one exact interleaved CI step chain, creates a closed install environment containing only `CI`, private `HOME`/`TMPDIR`, fixed locale, empty `NODE_OPTIONS`, and the inspected `PATH`, records its admitted keys, and adds direct negatives for stale state, materialization, cleanup, main-index drift, and first-attempt execution. Focused remediation tests pass 30/30. Because these changes alter bytes, `f62d5d7e...` remains historical rejected evidence only; the current successor is not frozen or authorized.

## Post-Review-A-remediation implementation gates

After the final source/test remediation and before exact-tree freeze, the sequential canonical chain passed:

- format check, lint, and typecheck;
- focused workflow/matrix regressions: 30/30;
- full suite: 534/534 across 43 files;
- build;
- MCP, public-error, lifecycle, CLI, and packed-tarball smokes;
- dependency audit with no suggestions;
- Yarn pack dry-run;
- workflow policy: PASS, 3 workflows / 9 jobs / 24 pinned action invocations;
- `git diff --check`.

This cohort is historical implementation-gate evidence, not exact-tree release authorization. Replacement quality review later reported four Medium findings: clean-worktree-only diff checking, direct-child-only timeout handling plus unverified materialization cleanup, incomplete terminal FAIL evidence including PASS-before-cleanup, and inherited runtime-gate environment. Therefore tree `c07083935495d38d6581f995f38ed2c431d3077e` and its 15/15 matrix are rejected historical evidence; no canaries were admitted for that tree.

## Replacement-review remediation

The current bytes:

- require CI checkout depth 2 and run `git diff --check HEAD^ HEAD` in CI and each synthetic candidate worktree;
- execute every bounded command in its own POSIX process group and terminate descendants on timeout;
- validate failed materialization cleanup, publish runtime reports only after cleanup, downgrade prepared PASS on cleanup failure, and emit terminal summary FAIL for preflight/runtime/cleanup paths;
- replace inherited runtime-gate environment with a fixed allowlist and report its admitted keys;
- directly regress candidate whitespace, shallow checkout, contaminated environment, grandchild termination, cleanup downgrade, and preflight FAIL evidence.

Focused replacement-remediation tests pass 34/34. The first canonical-chain attempt correctly stopped at lint because the combined materialization/cleanup error used the secondary cleanup error as `cause`; both combined-error sites now preserve the primary failure as `cause` while retaining cleanup in `AggregateError.errors`.

After that correction, external transcript `ast-cold-replacement-gates-20260812T014506Z.log` records a sequential PASS through format, lint, typecheck, 538/538 tests across 43 files, build, five smoke families, audit with no suggestions, package dry-run, workflow policy, and diff check. This remained pre-freeze implementation evidence because recording it and refining the final terminal phase changed bytes. At that stage, fresh exact-tree gates, matrix, four canaries, Review A, archive transition, Review B, commit/push, and exact-SHA remote CI remained pending for the next frozen tree.

Tree `d2898634fac2a501415ca1d4e5062b76d559d2f3` is also rejected historical evidence. Its first Node 22.5 matrix attempt stopped at the test gate after 5 commands with cleanup PASS. The closed runtime `TMPDIR` exposed test fixtures that used ambient `os.tmpdir()` for paths whose production contracts deliberately require physical `/tmp`: release evidence and raw canary output. The remediation keeps runtime `HOME`/`TMPDIR` private and makes those fixtures use their explicit physical authority; the failed cohort is not retried or counted as PASS.

## Final evidence-ledger bridge

Tree `2a2046adfd1458ac6399e41ee11c033f6d20945f`, with authenticated parent `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`, passed the sequential canonical gate recorded in external transcript `ast-cold-successor-gates-20260812T020621Z.log` (SHA-256 `ea4f68ffbe7e84814872bef7644941a459a395cb8a3210b16996ef08b90ec7af`): format, lint, typecheck, 538/538 tests across 43 files, build, MCP/public-error/lifecycle/CLI/package smokes, audit with no suggestions, package dry-run, workflow policy, and diff check.

Its fresh physical matrix passed all 15 commands under both Node `v22.5.0` and Node `v24.16.0`. Both immutable installations used Node `v24.16.0`; initial/final index tree remained `2a2046adfd1458ac6399e41ee11c033f6d20945f`; each cleanup passed. Report digests:

- summary: `649635ec9d57602a9489b946a2e0489888e7d2c7e6ea531f63ed8d1d1da49f12`;
- Node `v22.5.0`: `daf415186776569a66473c14885948bed655a8fe84b34ae3ec757759fd3752b7`;
- Node `v24.16.0`: `4155b96e6c0000fdea411a0ce31baae1b6b75582737a22b7822e7e1b5044db88`.

The first four-canary orchestration for that tree is diagnostic only: it materialized the correct synthetic commit but invoked Yarn from the caller checkout. It did not authorize Review A. The corrected v2 cohort authenticated physical `PWD` inside synthetic commit `85f46555cdf06835fcff201aa6f76254abe2192f`, tree `2a2046adfd1458ac6399e41ee11c033f6d20945f`, sole parent `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`; performed a cold immutable Node 24 install there; and passed all four canaries with 40/40 gates, 20 iterations, and 3 restarts. The exact-tree worktree remained clean and was removed with no Git metadata remaining. V2 transcript SHA-256: `2487ebe4273c214044e6c0a15ee4468eda6e329c1c1fcdc32c76ca701e3fffdf`. Raw report digests:

- `ast-mcp-server` / Node `v24.16.0`: `eee3a98b84c15e9951b6da7e00920a6f68b804de9818b705a1a9d419b39a0f52`;
- `ast-mcp-server` / Node `v22.5.0`: `0511250666f3d8492fb7c2332a34894c1f5bc1fd85e8f6c7fd932daa5b883ca0`;
- `x-scraper` / Node `v24.16.0`: `811b71629ad365be1fb1d4155bc06e4c03296becc3199d9b1a257c55df56667e`;
- `x-scraper` / Node `v22.5.0`: `aa372ffac5608d02839c0c8b63d52711ef420c8b1b9bc78a8141df29d3bca673`.

Both `x-scraper` reports bind clean commit `a86fffb15ad21912a87583c2d498f813c47aa27e`, tree `9c359690b58867e01750905b76b1c0cca3ad15a2`. All four package identities were clean and bound to the exact synthetic candidate tree.

Recording that ledger created documentation-only successor `2135c5bf10260d12dff1926cb5c2b9f9a4a64a5f`. Its prospective matrix/canary condition was exercised before Review A, but the following findings rejected the tree and reopened every dependent transition.

## Rejected final-ledger Review A cohort

Tree `2135c5bf10260d12dff1926cb5c2b9f9a4a64a5f` was reviewed through synthetic commit `0aa51c5aa91c82e33244a41bccbb491e60f830a8` with sole parent `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`. Its exact-tree gate transcript SHA-256 was `f827aa9523c7db2950a7b6f6c7cb4e6e7656d581f5171ef317e0e55ceb4708b7`; the gate passed format, lint, typecheck, 538/538 tests across 43 files, build, five smokes, audit, pack, workflow policy, candidate delta, and cleanup.

The physical matrix passed 15/15 commands under both Node `v22.5.0` and Node `v24.16.0`, with Node `v24.16.0` performing both immutable installations, private closed environments, stable initial/final tree, and cleanup PASS. Report digests:

- summary: `eb0d1dcb992cc10085bb326d9d260886930466246e8410dc286eae367e3b2975`;
- Node `v22.5.0`: `51520c8170d386a6ca8dd7f4d21b2d1f059a6c7680b41696ef58b72da7f89b63`;
- Node `v24.16.0`: `835c7c3cb1c29bcf95b59aa5ff13eaa8b5e804dd30bdf8539be8201741c7d596`.

The four-canary transcript SHA-256 was `2da02756425ebdf86c96a9618149785923abcd8f2b718ab83ba565dcf8871255`. Each raw passed 40/40 gates with 20 iterations and 3 restarts:

- `ast-mcp-server` / Node `v24.16.0`: `a0f8a83ba2f58bb31f4cb438015c6740b5aadc3acc80d311de1a206d30dc8f28`;
- `ast-mcp-server` / Node `v22.5.0`: `6444ef090f8562af60df1ba341e858b9b7ebe34bf4dbf516357fcb57e82e3c49`;
- `x-scraper` / Node `v24.16.0`: `963a2fac8e96d5544e93fe74d57cf3ed3845a5f1ef78537658933f018b0887b5`;
- `x-scraper` / Node `v22.5.0`: `03edc67e4176d06cee45f651784b7d38312eec30fbd0caf92c37897dd4748280`.

Review A rejected that exact tree at unresolved Critical/High/Medium `0/0/2`. The first Medium found that a combined materialization-plus-cleanup `AggregateError` reached terminal reporting only as `runtimeError`, causing a false `cleanup_status: pass` and dropping the cleanup error. The second found that `tasks.md` marked the matrix and canaries complete while this exact cohort existed only in temporary evidence and the durable ledger still ended at tree `2a2046adfd1458ac6399e41ee11c033f6d20945f`. The security/CI and quality/runtime lanes timed out before verdict and do not count as approvals.

The successor remediation used a domain-tagged combined failure to separate the primary and cleanup outcomes before terminal publication, preserved both error messages and the primary phase, and tested PASS/PASS, FAIL/PASS, PASS/FAIL, and FAIL/FAIL. The combined materialization/cleanup case was exercised through the CLI orchestration path, while an unrelated two-member `AggregateError` remained an ordinary primary failure. It reopened matrix, canaries, Review A, archive, Review B, commit/push, and exact-SHA remote CI. The rejected `2135c5bf...` artifacts remain historical evidence only.

## Rejected Node 22.5 test-launch cohort

Tree `e06b88fb20e2c2181368fa5486bff60436f9d453` passed the sequential local candidate gate with 540/540 tests across 43 files, build, five smokes, audit, pack, workflow policy, and candidate-delta checks. Its first physical matrix attempt then stopped at the Node `v22.5.0` test phase after install, format, lint, and typecheck passed. Cleanup passed, the caller index remained the exact candidate tree, and no caller unstaged or untracked paths appeared. The terminal report digests are:

- summary: `b759a826e107533aab83abe7b4f9a867122e7ce8c32636ea3f24e20235d588bc`;
- Node `v22.5.0`: `022283454c66e7f43d3cfb87db3c092ea706d4993bfd3eb840f20e2b96f94308`.

The failure localized to the combined materialization/cleanup CLI regression test. Its child environment attempted to remove `GIT_INDEX_FILE` by assigning JavaScript `undefined`; Node 24 omits that key, but Node 22.5 serializes it as the literal string `"undefined"`. After that preflight was made explicit, a focused Node 22.5 run exposed a second launcher assumption: the extensionless fake `git` executable used ESM syntax that Node 24 detects but Node 22.5 treats as CommonJS. The remediation deletes `GIT_INDEX_FILE` from the inherited environment, implements the extensionless fake executable as CommonJS, and reports child stderr directly if terminal evidence is absent. Production preflight and cleanup behavior remain unchanged while the same CLI failure path now runs under both supported runtimes. These edits invalidate `e06b88fb...`; its matrix is rejected first-attempt evidence and no canary was started for it.

## Rejected Git-authority Review A cohort

Tree `1c9f23b8c5428e663382a1fc00819f58ae0561ff` was materialized for Review A as synthetic commit `5d2965499d8726742793d6c1a3f2f3b6acbc8182` with sole parent `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`. Its fresh matrix passed 15/15 commands under both Node `v22.5.0` and Node `v24.16.0`; both installations used Node `v24.16.0`. The four exact-tree canaries each passed 40/40 gates with 20 iterations and 3 restarts, and cleanup left no temporary candidate worktree or cache root. Those functional results remain historical only.

Review A consolidated to `REQUEST_CHANGES`, unresolved Critical/High/Medium `0/1/0`. The SDD/evidence lane and quality/runtime/mantenibility lane each returned PASS `0/0/0`. The security/CI lane found that all candidate-authentication and materialization Git calls still resolved `git` through inherited `PATH` and inherited ambient Git controls other than `GIT_INDEX_FILE`. A prepended executable or `GIT_DIR`/`GIT_WORK_TREE`/`GIT_CONFIG_*` redirect could therefore falsify the preflight, substitute workspace bytes, and falsify the postcondition while the reports claimed the requested tree. Review A did not authorize archive, ADR, Review B, commit, push, remote CI, or publication.

The successor remediation centralizes Git evidence authority in `scripts/git-evidence-authority.mjs` and uses it from both the matrix and canary harness. It fixes `/usr/bin/git`, proves its physical path, type, root ownership, non-writable mode, executability, version output, and SHA-256 digest, and records a path-free identity. Every ambient `GIT_*` key is rejected before candidate parsing/authentication and before evidence output creation. Repository-bound children receive only a closed environment with fixed system `PATH`, locale, non-existent home/config roots, disabled system/global configuration and prompts, an empty attribute source, command-scope controls that neutralize hooks, filesystem monitoring, untracked cache, attributes/excludes, filters, external diff, line-ending and filesystem-behavior drift, plus internally fixed `GIT_WORK_TREE` and `core.worktree`. Contradictory repository controls are rejected. Only exact synthetic author/committer fields are admitted for `commit-tree`.

The canary raw schema now includes a `git_authority` gate and path-free Git identity. All four reports must share it. Live freeze validation, the pre-publication package check, and the immediate pre-visibility callback each recompute the authority; an identity change aborts publication. The runtime diff gate likewise uses the absolute binary, closed repository-bound environment, and `--no-ext-diff`.

RED first observed three focused failures: the diff plan still used bare `git`, the Git environment/rejection helpers were absent, and a PATH-prepended fake executable wrote its sentinel. A later hostile-local-config regression then demonstrated that merely setting `GIT_CONFIG=/dev/null` does not suppress `.git/config`; executable `core.fsmonitor`/filter configuration still ran. After command-scope closure, a `core.worktree` substitution regression proved that repository discovery also required internally fixed `GIT_WORK_TREE`. The final adversarial test passes with no sentinel execution and indexed bytes from the validated root rather than the forged worktree.

Post-remediation implementation gates on the final source bytes passed:

- focused Git-authority, matrix, and canary regressions: 47/47;
- full suite: 548/548 across 44 files;
- lint, typecheck, build, and `git diff --check`;
- Prettier over every changed candidate path.

These results remained pre-freeze implementation evidence. At that stage, a new exact successor tree, first-attempt Node 22.5/24 matrix, four successor-bound canaries, and fresh Review A remained pending; no prior matrix, canary, or review result was reusable.

## Rejected private-index clone cohort

Tree `f1c8cc54d30ae155c8071051daebd33679084b15` passed its fresh first-attempt physical matrix at 15/15 commands under both Node `v22.5.0` and Node `v24.16.0`. Both reports recorded cold workspaces, Node `v24.16.0` immutable installation, stable caller index, and cleanup PASS. Matrix artifact digests:

- summary: `988c752fcaf228419e2d66276625f8bafb8f352026e8e9af0fa5f7a4804432e1`;
- Node `v22.5.0`: `ab9e0a6a908abb3c872d32c37d28adc60db7bc3f17c365ef3d9b89a3a6687b62`;
- Node `v24.16.0`: `b2fffcab501fe652ec28785af13618c1dff4f9482e839a013f1c8edade7ec7e1`;
- matrix transcript: `ac487918f4f5a15f0045fa5170387261fbf2bfc974d2d9fc7728ef3ddb493e58`.

Its first canary attempt authenticated synthetic commit `d587efd1bd213d37b9408151c77644571e534528`, the exact candidate tree, sole parent `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`, clean initial/final candidate bytes, stable caller index, and clean `x-scraper`. It then failed before creating the first raw report: the private-index `git clone --shared --no-checkout` child inherited `GIT_WORK_TREE` and command-scope `core.worktree` for the already-existing source checkout, and Git 2.53 rejected it with `working tree ... already exists`. Cleanup removed the registered worktree, temporary root, metadata, and all cache roots; zero raw reports remained. Rejected canary transcript SHA-256: `9feb6ba915da710cce70db4c5dba704439e16902d512f7784b18ae7b94384b26`.

The successor keeps the absolute Git binary and closed configuration for clone but omits source-worktree controls from that one child. The source/destination remain explicit absolute argv authorities; subsequent temporary-index operations restore internally fixed `GIT_DIR`, source `GIT_WORK_TREE`, disposable `GIT_INDEX_FILE`, and command-scope `core.worktree`. A direct regression reproduced the original Git 2.53 rejection before implementation and passed afterward against the real existing checkout. The failed tree was not retried or eligible for Review A; the successor required a new full gate ledger, first-attempt matrix, four canaries, and reviews.

## Rejected Git-snapshot-retry Review A cohort

Successor tree `87a40fa6a445a0b867e11fa46e0e3804da1e9eea` was materialized for Review A as synthetic commit `8b0e3d0667fb53c7bb3ca237c390a2e72b281830` with sole parent `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`. Its fresh first-attempt physical matrix passed 15/15 commands under both Node `v22.5.0` and Node `v24.16.0`; both immutable installations used Node `v24.16.0`, caller index identity remained stable, and cleanup passed. Matrix artifact digests:

- summary: `0b99a2bd5cdcbbc92aec4cd19ca600c4fefbcf6ed31f5a3c98b8b04d60a1eb65`;
- Node `v22.5.0`: `5dc466297fb34e8bd874a55400e8f167dd00db7b248f7efdd0ee8175f9b50bd9`;
- Node `v24.16.0`: `d2b1a70993ca1045f08ecc30448730ee0e707a58d1b3574bfe4e0c94ceec6f7b`.

All four sequential exact-tree canary producers returned `overall_pass: true` with 41/41 gates. The cohort transcript contained no `git_tree_retry` event, so those reports came from their first physical snapshot attempts. Raw artifact digests:

- `ast-mcp-server` / Node 24: `ab57ab75f50982ba46656a3f4876a7d073e504ada41daa0fa1dc0b5b4af61239`;
- `ast-mcp-server` / Node 22.5: `c5edecd2afe493031f88cae80c826d32de48fcf9cbf0f88b452f0e242189b84c`;
- `x-scraper` / Node 24: `146cf090243b795d056124edaced7001aa75e7b9f9a6b2a0d201d8ef7d5babdb`;
- `x-scraper` / Node 22.5: `2db9a9c9f000472fb060603f4d924ba35820b43eccf88441c2f1855c81cf5316`;
- cohort transcript: `f4e28311ee6a1dca193096c68142f11210f949d3ec7ada6af1cb4d212455a5f8`;
- freezer/oracle transcript: `86fa9a2d742be0e735a2c40c6f079ea28d87d770fc857488d76a2318ecd583a8`.

Review A returned `REQUEST_CHANGES`, unresolved Critical/High/Medium `0/0/1`. The behavioral/code-quality lane found that `currentWorktreeTree()` retried the complete clone, temporary-index materialization, integrity check, and cleanup attempt up to three times. A later success could therefore hide a failed first evidence-authority or cleanup attempt, contrary to COLD-CI-002. The direct clone regression covered only `currentWorktreeTreeAttempt()` and did not close this wrapper behavior. The SDD and security replacement lanes independently identified the same issue but withheld formal verdicts because final reviewer-side reauthentication was administratively denied; they do not add separate severity counts.

RED then proved both failure classes: an injected first snapshot failure followed by a possible success and an injected first cleanup failure followed by a possible success each resolved successfully under the rejected implementation. The remediation makes `currentWorktreeTree()` invoke exactly one attempt and adds two direct assertions that the original error is retained and the attempt count remains one. Focused GREEN passed 2/2. Because this changed harness and test bytes, every matrix, raw, freezer result, and review above is historical rejected evidence only; a new exact successor tree required the full gate ledger, first-attempt matrix, four canaries, and fresh Review A.

The corrected pre-freeze tree `9524a688dca30b02ceec1687eb34f1d67d9c3086` was materialized as synthetic commit `3821e77e5a2df2511586642ed070965077b8efa1` with sole parent `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`. External transcript `ast-cold-single-attempt-exact-gates-9524a688.log` (SHA-256 `e35e6bcfcca279c95ab6fadf9104a2de7261bee0b4c31c53ef1f95563d7a74e4`) records an immutable Node `v24.16.0` installation followed sequentially by format, lint, typecheck, 551/551 tests across 44 files, build, MCP/public-error/lifecycle/CLI/package smokes, audit with no suggestions, pack dry-run, workflow policy for 3 workflows / 9 jobs / 24 pinned action invocations, and candidate-delta diff. The final tree remained exact and the isolated worktree status was empty. This ledger was pre-freeze implementation evidence; recording it created a documentation successor that required its own first-attempt matrix, four canaries, and fresh Review A.

## Final successor cohort and Review A authorization

The final pre-archive candidate was authenticated as tree `03c0dee3a63e8627f22c072b0a6072b881b808d3`, synthetic commit `b760017f32c773623ace0f476c0047b511da6a58`, sole parent `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`, and an exact 16-path parent delta. `git diff --check` passed, the caller index equalled the candidate tree, and there were no unstaged tracked or non-ignored untracked paths.

Its single first-attempt physical matrix passed all 15 commands under Node `v22.5.0` and all 15 commands under Node `v24.16.0`. Both immutable installations used Node `v24.16.0`, and all matrix cleanup completed. Artifact digests:

- summary: `66d4bfaba72c83286528ac5968f944ab283e6caa72ef182fc185bd8f4104a3b5`;
- Node `v22.5.0`: `2b764e0030005c1f96b9dace12bac560bd5a4d4c6118710e1ffb9525513b4735`;
- Node `v24.16.0`: `85d316f3341a75284e547ba76723654cfaf701071d004a91435226a033ae36d3`;
- matrix transcript: `913d840a149bd6037cdeb12a2bd1d9ffbbf7961363494fe64147a6f1dceb2d6c`.

Four sequential exact-tree canaries each returned `status: pass`, `overall_pass: true`, and 41/41 gates with 20 iterations plus 3 restarts. The only false booleans were the required negative postconditions: fixture cache absent, package clean, project clean, and default-off cache absent. Raw and cohort digests:

- `ast-mcp-server` / Node `v24.16.0`: `1e7fec8bba484be31a880b9ec2a29194811e4e3a1c59a1e72722c111aa2d2a6c`;
- `ast-mcp-server` / Node `v22.5.0`: `0976f77aaf6bb0eebbb9dd24a9b7d72cba5cfb67cd501efec39bc7f1bcddc0a7`;
- `x-scraper` / Node `v24.16.0`: `7f9c1ec673ad9aa3a12e8611d4cd11c9df58fff10c0c6cac4afe64ded9bd97ac`;
- `x-scraper` / Node `v22.5.0`: `6689cfdf725fe038836d337e49d57a5997dbc7dcf08fb7210a16009d556221c8`;
- cohort transcript: `26e334a06cca72aad7abd76cb56b6739221ddd2c14376e1820c19ec41c0602c3`.

The physical `x-scraper` authority remained clean at tree `9c359690b58867e01750905b76b1c0cca3ad15a2`. The official freezer validated the complete preregistered four-member set, raw/schema/gate/identity/canonical-byte boundaries, and then stopped solely at the expected inherited-destination no-overwrite boundary; it did not publish new checked reports. Its transcript digest is `46ea43fec7bffec356f9b049489648d695600d5dc71a0fc763aae477de821d63`, and cleanup left zero owned residue. The ten matrix/canary/freezer artifacts above remained digest-stable after the transition.

Review A independently authenticated the same immutable commit, tree, parent, clean status, 16-path delta, whitespace check, and read-only review surfaces before each formal verdict. All three lanes passed with no Critical, High, Medium, or Low findings:

- SDD/spec compliance: PASS `0/0/0`, transcript digest `f898b5ad250a057e11465e43c6c95c595ac4bbf29ccf2d7e0ad16f2e32fcbb72`;
- CI/security: PASS `0/0/0`, transcript digest `2329142501215aca6681114af020250b432e3f5630d8234005e0a2ede53c5b2f`;
- behavioral/code quality: PASS `0/0/0`, transcript digest `b2e61ec0260263121919ec2d5ebaa002640a18ae0f93356282230c51c3b78b0f`.

The consolidated Review A verdict is PASS with unresolved Critical/High/Medium `0/0/0`; the bounded owner ledger digest is `a54ca4595d5f74aa725a3b0c58ef7e8ca941304fa4757dc16d38e0798f6b993f`. This authorizes only the task/verification reconciliation and complete SDD archive move. The resulting post-archive tree still requires affected exact-tree gates and Review B before any commit or push. npm publication, dist-tag mutation, Git tag creation, and GitHub Release creation remain prohibited.
