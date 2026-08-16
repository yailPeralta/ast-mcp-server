# Verification: promote SQLite symbol-index persistence to default

**Date:** 2026-08-14
**Status:** v5 producer evidence green; final documentation sibling and replacement Review A remain pending
**Baseline HEAD:** `34f6a8eeb52acf9bd082cbdff7fc450ccea8abe0`
**Baseline tree:** `1eb1256f98f315054ded2cf14a3dd42ca48589a7`

This record distinguishes scoped implementation evidence and diagnostic worktree runs from final exact-tree release evidence. It does not claim that the current dirty worktree is a reviewed, committed, published, or release-ready candidate.

## Environment exercised

- Linux x64 host.
- Exact lower runtime: Node.js `v22.13.0`.
- Governed upper runtime: Node.js `v24.16.0`.
- Yarn `4.15.0`, authenticated descriptor-bound against caller-supplied exact bytes under a private authority root.
- npm `10.9.2` with Node `v22.13.0` and npm `11.13.0` with Node `v24.16.0`; both local-registry lanes execute absolute manager entries through their descriptor-authenticated Node runtime and force transitive `node` resolution to a private `0700` directory containing only a separately authenticated byte-identical Node binary.
- `NODE_OPTIONS` was empty for active promotion evidence.
- Historical Node `22.5.0` reports and `--experimental-sqlite` controls remain point-in-time evidence only; they are not attributed to this promotion.

## Requirement traceability

| Requirement       | Implementation authority                                                                         | Assertion and transport evidence                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IDX-DEFAULT-101` | `src/services/project.ts`, `src/services/symbol-index.ts`, `src/services/symbol-index-sqlite.ts` | Store conformance, project, MCP and operation tests retain compiler/source/config snapshots as authority; checked reports require compiler parity and mutation isolation.                                                                                                                                                                                                                                                      |
| `IDX-DEFAULT-102` | `src/services/symbol-index-policy.ts`, `src/services/project.ts`                                 | Policy, project and MCP tests prove absent/exact `enabled` selects requested `enabled` plus SQLite, while unknown values fail closed. Package and local-registry smokes omit the policy variable and require rebuild then restart hit.                                                                                                                                                                                         |
| `IDX-DEFAULT-103` | `src/services/symbol-index-policy.ts`, `src/services/project.ts`                                 | Policy tests prove `disabled` returns memory before HOME/XDG/root resolution. Project, benchmark, package and consumer gates prove no cache creation/open and byte-preserving rollback after a populated default cache.                                                                                                                                                                                                        |
| `IDX-DEFAULT-104` | `src/services/symbol-index-policy.ts`, `src/services/symbol-index-sqlite.ts`                     | Policy tests reject missing, relative and non-normalized canary roots. Package, registry and canary transports retain explicit canary compatibility without a policy-name migration.                                                                                                                                                                                                                                           |
| `IDX-DEFAULT-201` | `src/services/symbol-index-policy.ts`, `src/services/project.ts`                                 | Policy tests cover explicit root, XDG and home precedence; invalid explicit overrides fail closed without implicit fallback. Project/MCP failures retain bounded memory fallback and redact physical paths.                                                                                                                                                                                                                    |
| `IDX-DEFAULT-202` | `src/services/project.ts`, `src/services/symbol-index-sqlite.ts`                                 | Project tests keep fresh-project construction side-effect free. SQLite tests require capability checks before creation, trusted non-writable ancestry, owner-only created suffixes, unchanged external parent modes, descriptor-bound main opens, `0600` artifacts and no-follow inode reauthentication.                                                                                                                       |
| `IDX-DEFAULT-203` | `src/services/symbol-index-cache.ts`, `src/services/symbol-index-sqlite.ts`, `src/cli.ts`        | Cache/CLI tests cover bounded inspect, explicit `--yes`, unknown-file preservation, private root/descendant modes, symlink/hard-link/non-regular/path replacement refusal, parent-chain identity, descriptor-bound activity probes, and an exclusive WAL/SHM/main group guard that refuses pathname replacement or reader/writer races with zero deletions. No automatic GC is introduced.                                     |
| `IDX-DEFAULT-301` | `package.json`, `.github/workflows/ci.yml`, `scripts/release-candidate-matrix.mjs`               | Engine/workflow tests require `>=22.13.0`; the matrix authenticates exact Node `v22.13.0` and Node 24 with empty `NODE_OPTIONS` and the known lower-runtime warning only.                                                                                                                                                                                                                                                      |
| `IDX-DEFAULT-302` | `src/services/project.ts`, `src/services/symbol-index-sqlite.ts`                                 | Project/MCP/storage tests cover capability, root, open, migration, corruption, read/query/write/flush/close and compiler-change fallback/recovery. Status retains requested policy, effective memory backend, failed state and bounded reason/counters.                                                                                                                                                                        |
| `IDX-DEFAULT-303` | Existing operation scheduler plus `src/services/project.ts`                                      | `test/operations.test.ts`, package/registry consumers and checked reports prove mutation-only prepare/apply/replay creates no cache and preserves plan, diagnostics, rollback and receipt semantics.                                                                                                                                                                                                                           |
| `IDX-DEFAULT-304` | Existing public status schema, `src/services/project.ts`, support/security docs                  | Project/MCP tests assert bounded JSON-safe policy/backend/state/operation/counters without roots or secrets. `enabled_not_released` remains schema-compatible but unreachable for a valid default.                                                                                                                                                                                                                             |
| `IDX-DEFAULT-401` | `scripts/benchmark-symbol-index-integration.mjs`, package and registry consumer smokes           | Dual-runtime deterministic and packed-consumer gates cover default rebuild/hit, explicit disabled rollback/no-root, canary, private artifacts, delta refresh, typed fallback/recovery, cache inspect/clear and mutation isolation in private environments.                                                                                                                                                                     |
| `IDX-DEFAULT-402` | `scripts/canary-local-mcp.mjs`, checked workload reports                                         | Four schema-2 reports bind `ast-mcp-server` and `x-scraper` under exact Node `22.13.0` and Node `24.16.0`, each with 20 warm reads, three restarts, 42/42 gates, parity, rollback, mutation isolation and resource/cache evidence. Final evidence-sibling matrices execute 15/15 ordered commands per runtime.                                                                                                                 |
| `IDX-DEFAULT-403` | `scripts/canary-local-mcp.mjs`, `scripts/release-candidate-matrix.mjs`, frozen checked reports   | Producer/freezer tests require runtime/harness/workload/repository identities, closed schema validation, atomic no-replace publication and exact-tree reauthentication. The local-registry harness additionally authenticates Node/Yarn/npm file, version and digest identities and binds both managers to the authenticated Node under a closed path policy. Historical reports remain byte-identical and separately labeled. |
| `IDX-DEFAULT-404` | ADR 0011, ADR 0009/0010, workflow policy, `tasks.md` and this ledger                             | ADR 0011 records only the `Unreleased` technical decision; task/verification gates keep commit, push, npm publication, dist-tags, tag and hosted release as separate unauthorized transitions. Review A tree `d80d4095…` returned one specific package-manager-authority Medium finding, so release readiness remains false until a repaired exact tree passes with zero unresolved Medium-or-higher findings.                 |

## Scoped independent reviews

These reviews authenticate only their named slices and hashes. They do not replace final whole-candidate Review A.

### Policy/runtime

- Review `deleg_340ebfa6`: `PASS`, zero Medium-or-higher findings.
- Focused evidence: 51/51 tests.
- Scope included default policy, root precedence, exact runtime floor, package/workflow selectors and associated tests.

### Private SQLite storage

- Recovery review `deleg_af690e2d`: `RECOVERY PASS`, zero Medium-or-higher findings.
- Focused recovery evidence: 6/6 on Node `v24.16.0`.
- Authenticated SHA-256:
  - `src/services/symbol-index-sqlite.ts`: `5d55d09b68f4d9dd0fa97cbbc52a335adc8810247824bf33c135e0942d4175b3`;
  - `test/symbol-index-sqlite.test.ts`: `a3784102742922cd4cc5610366b0421c19077c7d88a21929bb0fb944e4acdc0f`;
  - `spec.md`: `1f3d6bf6cb4ebed1e5944f5e3e391b45ecde42508158567fabb8c7abdd7d1e54`.

### Cache CLI

- Recovery review `deleg_2d16ace1` task 1: `RECOVERY PASS`, zero Medium-or-higher findings.
- Focused evidence: 14/14 on exact Node `v22.13.0`, empty `NODE_OPTIONS`.
- Authenticated SHA-256:
  - `src/services/symbol-index-cache.ts`: `7a05f377d470fc05e1e8c5e1f51c05212127d71dce7ece4426f03f4052ac9366`;
  - `test/symbol-index-cache.test.ts`: `7aab6826829b7ef9762c2a8931eac200fab858fa1a2bc38236c2a6ca65105541`;
  - `spec.md`: `1f3d6bf6cb4ebed1e5944f5e3e391b45ecde42508158567fabb8c7abdd7d1e54`.

### Review A v5 remediation recovery

- Focused recovery candidate `f1a851d30ff94cc8154d8545224c5245de49a115` was reviewed in `deleg_06c05490`.
- Traceability lane: `PASS`, `critical=0`, `high=0`, `medium=0`, `low=0`; the prior shifted/undeclared-ID finding is closed.
- Security lane: `REQUEST_CHANGES`, `critical=0`, `high=0`, `medium=1`, `low=1`.
- The Medium finding proved cache activity probes still reopened the main pathname after adversarial hooks instead of binding SQLite to the inventoried inode. The Low finding required descriptor-capability failures to remain capability failures rather than read/write corruption labels.
- Tree `f1a851d3…` is obsolete as a report or readiness candidate. The second remediation adds private cache-root enforcement, descriptor-bound cache activity probes, a valid-SQLite outside-swap regression and capability-failure typing. Focused evidence is 57/57 and complete evidence is 689/689 on exact Node `v22.13.0` and Node `v24.16.0`; exact-tree matrix, reports and replacement Review A remain pending.

### Lifecycle, observability and mutation isolation

- Recovery review `deleg_2d16ace1` task 2: `RECOVERY PASS`, zero Medium-or-higher findings.
- Authenticated SHA-256:
  - `src/services/project.ts`: `27f50c0c6a288cb3e8b7f055219cb1a45db1a2b807acfa47053964bfb01b4270`;
  - `test/project.test.ts`: `efafda5742a60403cc2640ac1403e1ce29506590737abd1e38387a3993ffdc0b`;
  - `test/mcp.integration.test.ts`: `790f7717dbbd61610a71e1489032c1d46c89ae256e3f42d5b3cbc85e36bfcd56`;
  - `test/operations.test.ts`: `b22a1871b3c457e6671ae5d5c42a5e4a30ab3109567692b350c752ace46a55fe`;
  - `test/setup.ts`: `e6013a0a5b9f3adc905dd23d64c340ffac3b4978bb751c16603e8840fa21b9e0`;
  - `vitest.config.ts`: `8556d9d62489013270e2762709cc7733f16c220888dd0c48638646198b40dc1f`;
  - `spec.md`: `1f3d6bf6cb4ebed1e5944f5e3e391b45ecde42508158567fabb8c7abdd7d1e54`.

Out-of-scope worktree paths changed during some reviews; each reviewer reauthenticated the reviewed hashes and made no edits.

## Commands and observed diagnostic results

### Local-registry packed consumer

Evidence sibling `080a680077b23987257d3cbbc36b82dc68d24d5f` was exercised sequentially:

```text
Node v24.16.0: PASS, 22/22 gates
Node v22.13.0: PASS, 22/22 gates
```

External mode-`0600` reports:

| Runtime         | SHA-256                                                            | External report                 |
| --------------- | ------------------------------------------------------------------ | ------------------------------- |
| Node `v24.16.0` | `ea65cc88de4fc950fabd62ab64cd3cc1746f9d1788f8f27c677e3438a808522a` | `local-registry-node24.json`    |
| Node `v22.13.0` | `fab353b0bbf7a845f8be347005c40296f9dfe8dba084b3c4dd3804f538ae35bc` | `local-registry-node22.13.json` |

Each report contains no false gate. The setup gate binds first-pass MCP/skill/guidance installation and second-pass zero-write convergence for explicit Claude and Hermes fixtures. The exact tree and cleanliness were reauthenticated after both cleanups. `test/local-registry-consumer-smoke.test.ts` passed 3/3 on both runtimes, including bounded cleanup retry options and error propagation. Two owner launcher diagnostics were rejected before loopback startup or report creation: a Vitest-only command received the unsupported Jest flag `--runInBand`, then the smoke parser rejected the non-contractual `--report` option. The accepted literal vector used `--output` plus exact `--expected-node`; no functional gate was retried after execution began.

### Evidence-sibling release matrix

The 58-path manifest had SHA-256 `df486f9b5dfe80c3d394454255fb8646d066c6b6a27f7ab499522e0c2446e822`, included the four checked reports and excluded the unrelated pre-existing archive report. It materialized as clean synthetic commit `5531c1553144cdea63cb808401bdddc3f50119d8` with tree `080a680077b23987257d3cbbc36b82dc68d24d5f`.

The matrix used literal `--output-dir` and `--candidate-tree` arguments, exported `AST_NODE_22_13_BIN` and `AST_NODE_24_BIN`, and kept `NODE_OPTIONS` empty. Both lanes passed the same 15 commands in order: immutable install; format; lint; typecheck; full test; build; MCP, public-error, lifecycle, CLI and package smokes; audit; pack dry-run; workflow policy; and diff check. Initial index tree, requested candidate tree and final index tree were all `080a680077b23987257d3cbbc36b82dc68d24d5f`.

| Matrix member    | Runtime      | Commands | SHA-256                                                            |
| ---------------- | ------------ | -------- | ------------------------------------------------------------------ |
| `node22.13.json` | `v22.13.0`   | 15/15    | `8527c0d564ff370ff3545ae37674f86a81ab4f1cc9b14c03238bfa0e4ae2848c` |
| `node24.json`    | `v24.16.0`   | 15/15    | `f26e2b29eccf2d5788966abc590b7fb1ddffee947f486a99a19fcfc50c6c49f6` |
| `summary.json`   | dual runtime | PASS     | `28f099dafbfd0b52df67284f327f0a30f430fb7410342d492d22a81600a51d2d` |

This section intentionally records the predecessor ledger tree. Editing this file and `tasks.md` creates one successor sibling. The pre-Review-A checkbox convention is prospective: it is true only if the owner reruns the complete matrix and local-registry consumer on that unchanged successor, externally records those reports and digests, and Review A reauthenticates the same tree. No post-rerun byte may be written back before Review A.

### Historical v1 checked cohort (predecessor only)

The immutable clean-committed package candidate was:

```text
package tree: d8defeb72e11091e562e820b69132c949533b218
synthetic evidence commit: 79b047de0ff89e5ef4999c6d6c9e68e6efbc5067
x-scraper HEAD: a86fffb15ad21912a87583c2d498f813c47aa27e
x-scraper tree: 9c359690b58867e01750905b76b1c0cca3ad15a2
```

The synthetic commit exists only in the disposable evidence repository; no ref, index entry or commit was created in the source checkout. Every raw report was written directly under `/tmp` with mode `0600`, passed the runner's own freezer-contract validation before write, and left both repositories byte-clean.

The predecessor atomic freezer published exactly these checked members in `production-readiness-sqlite-default-v1`:

| Checked member                  | Runtime    | Project            | Gates | Checked SHA-256                                                    | Raw SHA-256                                                        |
| ------------------------------- | ---------- | ------------------ | ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `ast-mcp-server-node22.13.json` | `v22.13.0` | `[ast-mcp-server]` | 42/42 | `1b75998404e4fd9b77b433b7fb74632a9da329a47341f7f7bb6d2b1f0d77c585` | `37a5ee61a5b2b59807a4c74d2fdccebde3216912aab501bfd8c4229bddf7bcf5` |
| `ast-mcp-server-node24.json`    | `v24.16.0` | `[ast-mcp-server]` | 42/42 | `ea69ff05d7daa0910b6727b98544c45f12f7a5a6d41dcdfea85ef43203bc301f` | `efa973ef5c1c1c10343dff1476de0e6a9a8acb9f5af2f02863b0d88d4a7c045c` |
| `x-scraper-node22.13.json`      | `v22.13.0` | `[x-scraper]`      | 42/42 | `befa66077e665f3a59d15118d2552cdde37c8e2cea09059243062701047606d4` | `67c4e98c30cfb200398244ac5e97fc45a714d2ab71a17216e7abf827077a18d8` |
| `x-scraper-node24.json`         | `v24.16.0` | `[x-scraper]`      | 42/42 | `6dcb8288f7e7392967741c761ccea92db3fe897533a5ba5167dadb6e9c6ec72a` | `4a5f84a25c725a2a34e9f2546b6c9889b122a582c620e7e05de73e99a118c5d9` |

All members use schema 2, 20 warm reads and three restarts. Their package `head_tree` and `tree` both equal `d8defeb72e11091e562e820b69132c949533b218`; the x-scraper members bind both project trees to `9c359690b58867e01750905b76b1c0cca3ad15a2`. Recomputed gates are all true, and canonical bytes contain no `/home/`, `/tmp/`, auth-token or password marker. The checked files were created mode `0644`; therefore v1 is predecessor evidence only and does not satisfy the final private-report permission gate. Its bytes remain unchanged.

Two predecessor freeze attempts failed closed and published no directory. The first rejected staged-only package identity. The second exposed a stale schema-2 validator that still required historical `disabled`/`canary` real-repository fields while `run` emitted `disabled_baseline`/`default_enabled`. The validator and fixtures now share the promoted contract, and each future PASS raw self-validates before publication.

### Freezer contract

After migration to schema 2 and the promoted default-enabled shape, `test/canary-local-mcp.test.ts` passed 27/27 on Node `v24.16.0`. It covers the closed four-member parser, active runtime identities, canonical validation, semantic gate recomputation, sensitive-text rejection, direct-`/tmp` no-follow/single-link inputs, complete-set binding, atomic no-replace visibility, staging/lock replacement and cleanup semantics. A RED permission regression reproduced the freezer's mode-`0644` output; the GREEN implementation creates every checked promotion report mode `0600`. Exact Node `v22.13.0` and final dual-runtime suites remain to be rerun after the last source edit. Historical v1 checked bytes remain unchanged.

The GREEN freezer contract then passed 27/27 under exact Node `v22.13.0` and 27/27 under Node `v24.16.0`.

### Superseded v2 checked cohort

The immutable clean producer was synthetic commit `270cff1a569036fda0be5f053aee455e62d9e861`, tree `b375a38fa974134056d816f8e292856971247d22`, parent `34f6a8eeb52acf9bd082cbdff7fc450ccea8abe0`. Its 54-path manifest excluded the four historical v1 reports and the unrelated archived OpenSpec report. `yarn install --immutable`, build, initial/final clean status and exact manifest equality passed. The external project remained commit `a86fffb15ad21912a87583c2d498f813c47aa27e`, tree `9c359690b58867e01750905b76b1c0cca3ad15a2`, clean before and after all runs.

| Checked v2 member               | Runtime    | Project            | Gates | Checked SHA-256                                                    | Raw SHA-256                                                        |
| ------------------------------- | ---------- | ------------------ | ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `ast-mcp-server-node22.13.json` | `v22.13.0` | `[ast-mcp-server]` | 42/42 | `355dc01fb084a844cf77685979e43fd05f9c81a3d5127b48fb0b6d149e4dfaf7` | `d469421c1755fb83e94e0205e98e5eae4f1eb5994fb90e7a9a61ce98a2d4c12f` |
| `ast-mcp-server-node24.json`    | `v24.16.0` | `[ast-mcp-server]` | 42/42 | `53891545899815ab27cfc8253deaaf4474d8d9f20104aca85e3f8c56894fa9b3` | `fb3d9e47b04b26c68843f4476207c17b131fc6aefdbab44d080b6f922227e7fe` |
| `x-scraper-node22.13.json`      | `v22.13.0` | `[x-scraper]`      | 42/42 | `b52f7e0971b5ce0d86d5e7a716108ed346f7559668ee00c1267dfd2389fbfe29` | `71bd6b88b8141d134154d331d198c826c0a8a43be8f62865419a8f9377be2b36` |
| `x-scraper-node24.json`         | `v24.16.0` | `[x-scraper]`      | 42/42 | `39af7eb46a1f754c60884c2a74e92d9ca0ab96b48770fd8fc7003f5f559e959d` | `0ccf9553e282c55cd883de838ae7d3978d6c31d34219737ae9037135b036bae5` |

Each checked member is schema 2, binds producer tree `b375a38f…`, contains 20 warm reads and three unchanged restarts, and has all 42 gates true. The v2 directory is mode `0700`; every member is mode `0600`. Post-publication scans found no host path or credential marker. Recomputed v1 hashes remained byte-identical to the predecessor table.

Focused recovery batch `deleg_b912727c` independently authenticated immutable tree `578886ad1980cfba082f761aec08582e0a3a632e`. Both security and SDD lanes returned `PASS`, with zero Critical, High, Medium or Low findings. That PASS closed the prior descriptor-reopen/capability findings but does not replace the pending whole-candidate Review A over the final evidence sibling.

### Rejected post-smoke code candidate

The 54-path code-only successor materialized as synthetic commit `22a3ce666b5fd50fc637d443c78c2a6052231024`, tree `ad3da867f9c0d9d9c58c59cd5eb3b9b81686ec5c`, parent `34f6a8eeb52acf9bd082cbdff7fc450ccea8abe0`, with manifest SHA-256 `5faede3fd8a6d336f2a89e485f123c2d78aaa3674d2258415113d83cda2c5f1f`. It excluded v1/v2/v3 checked reports and the unrelated archived OpenSpec report. Immutable install and build passed and the candidate repository remained clean.

Its first-attempt exact-tree matrix under Node `v22.13.0` passed install, format, lint, typecheck, 689/689 tests, build, MCP and public-error smoke, then failed the lifecycle gate before CLI/package/audit/pack/policy/diff or the Node 24 lane ran. `scripts/mcp-lifecycle-smoke.mjs` created its explicit canary cache root with default mode `0755`; the private-root policy correctly rejected it and exposed effective backend `memory` instead of the required `sqlite`. Cleanup passed, the candidate tree remained unchanged, and no partial cell was resumed. External failure reports were mode `0600`: `node22.13.json` SHA-256 `33076e42a5d109bdc54c17341fb98028b25c0c7526f1c38df4280dff7305242c`; `summary.json` SHA-256 `6639da0299372f46d379a76c3929db30db7ac0508c052e7c5c306c59a4669180`.

The successor source creates that canary root mode `0700`. The complete lifecycle smoke then passed independently under exact Node `v22.13.0` and Node `v24.16.0`, including close/reopen, protocol cleanliness and zero orphan processes. Because the fix changes governed bytes, tree `ad3da867…` is rejected and the entire matrix/report cohort must restart from a new candidate.

The next 54-path code-only successor materialized as synthetic commit `bc25a0cfb2817b6d561b307a2563c927e1892185`, tree `377465a1ea4c66c2d00c965b5ff80375ee70de22`, with the same path-manifest SHA-256 `5faede3fd8a6d336f2a89e485f123c2d78aaa3674d2258415113d83cda2c5f1f`. Its first-attempt matrix under Node `v22.13.0` passed install, format, lint, typecheck, tests, build, MCP, public-error, lifecycle and CLI, then failed package smoke before audit/pack/policy/diff or the Node 24 lane ran. `scripts/package-smoke.mjs` created its isolated HOME, XDG cache and TMP roots with default mode `0755`; the packed default-enabled server correctly fell back instead of rebuilding SQLite. Cleanup passed and the candidate repository remained clean. External failure reports were mode `0600`: `node22.13.json` SHA-256 `1ef039f8cec1ac52ede3e6993925ae9df30078400f8180d632012077084f943a`; `summary.json` SHA-256 `a060977e1273c5c51349c231a75a469ab59db3cae2c8d143240571f257db6bf6`.

The successor source creates those package-smoke roots mode `0700`. The complete packed tarball smoke then passed independently under exact Node `v22.13.0` and Node `v24.16.0`, including default SQLite rebuild, restart hit, private cache artifact, error correlation, global install and six idempotent agent targets. Because the fix changes governed bytes, tree `377465a1…` is rejected and the entire matrix/report cohort must restart from another new candidate.

The next 54-path candidate materialized as synthetic commit `afd2a1932e2220ebf9469ecc65a46daa8f8bdaa8`, tree `e79e2f9660e376212d51a861aceeb6bf29aacaa5`. Its first-attempt Node `v22.13.0` matrix passed install, format, lint, typecheck, tests, build, MCP, public-error, lifecycle and CLI. Package smoke then passed its packed default-SQLite rebuild/restart assertions but failed when spawning `npm` for the later global-install check: the physically copied runtime authority exposed exact `node` and `yarn` but omitted an `npm` executable from the closed PATH. This is an environment-axis failure, not a product assertion failure. Cleanup passed, no later package phase or Node 24 lane was resumed, and the candidate repository remained clean. External failure reports were mode `0600`: `node22.13.json` SHA-256 `045cbd8f2fe7a0ec2cb362ff27bd4c5523b44b2753e2c170957a1a7141d20e58`; `summary.json` SHA-256 `419d0511d475f916406baa7d5ccefbfcf102c5ca965105f684192a8049a9d951`.

The successor runtime authority `/home/yail/.cache/ast-sqlite-default-runtime-v15` is mode `0700` and includes a runtime-matched private physical npm package plus a same-directory executable wrapper for each Node lane. Node `v22.13.0` is paired with npm `10.9.2`; Node `v24.16.0` is paired with npm `11.13.0`; both use Yarn `4.15.0`. Recursive authentication found no symlinks or non-unit regular-file link counts; the common wrapper SHA-256 is `35096ed16546261ce46fd209ed8345e3f5a5747e6ba09bf02f3cda56a6ef7c15`. Even though product bytes did not require remediation, this evidence update changes governed documentation; the successor must therefore materialize a new tree and rerun the complete matrix from gate one.

The resulting 54-path candidate materialized as synthetic commit `da64e80e5eb5d6a128433c311dd757de877f0c55`, tree `4a60de755fb4d69ed1a55ecc12253e7389eacaae`, parent `34f6a8eeb52acf9bd082cbdff7fc450ccea8abe0`, with path-manifest SHA-256 `5faede3fd8a6d336f2a89e485f123c2d78aaa3674d2258415113d83cda2c5f1f`. Immutable install/build passed and the candidate repository remained clean. Its fresh exact-tree matrix passed all 15 ordered commands under Node `v22.13.0` and all 15 under Node `v24.16.0`; both runtime workspaces, initial/final index trees and candidate tree remained identical. The mode-`0600` reports have SHA-256 `2494f9b46ef140296d5d89446bd4786996baa0fd8982e890ffc14caf1b2848b7` (`node22.13.json`), `1bdb68af5d45d36352b620c1c33e425f8893f289d8fcce3747443f48b2f07933` (`node24.json`) and `c305229574e674c692cf5bbb2994d2236d35860f1dae6055fca555330c8a81aa` (`summary.json`).

The first exact-tree local-registry consumer attempt then failed under Node `v22.13.0` before writing an output report: its absent-policy default could not rebuild SQLite because the copied consumer had not created its XDG cache home. A focused successor made pack/consumer HOME, TMP and consumer ancestry owner-private, created valid owner-private default and mutation-only XDG homes, and left the explicit canary root absent so the package itself created the governed `0700` root. An intermediate diagnostic confirmed the second failure was `invalid_path` from group-writable consumer ancestry under the active umask; the final bounded failure message retains only fixed observability fields and no filesystem inventory. The full local-registry flow then passed all 22 gates under exact Node `v22.13.0` and Node `v24.16.0`. Focused mode-`0600` report SHA-256 values are `fab353b0bbf7a845f8be347005c40296f9dfe8dba084b3c4dd3804f538ae35bc` and `ea65cc88de4fc950fabd62ab64cd3cc1746f9d1788f8f27c677e3438a808522a` respectively.

Because the consumer-harness remediation changed governed bytes, the green matrix for tree `4a60de75…` is historical rather than final.

### Final code producer, v3 cohort and report sibling

The post-consumer-fix 54-path code producer materialized as clean synthetic commit `8f5489e0a066659fa903b2ad2cc69be00eaa48ec`, tree `b213f5b15bbc6d6889ca96f67517f86968a0da31`, parent `34f6a8eeb52acf9bd082cbdff7fc450ccea8abe0`. Its path manifest retained SHA-256 `5faede3fd8a6d336f2a89e485f123c2d78aaa3674d2258415113d83cda2c5f1f`; immutable install/build and clean initial/final authentication passed. The successor matrix then passed all 15 ordered commands under exact Node `v22.13.0` and all 15 under Node `v24.16.0`. Mode-`0600` report SHA-256 values are `d9ee3f4142379f678055a8e00e82df24a8e60e505332cb236565e06ee1be9211` (`node22.13.json`), `2e8ed91c9624ff32767a6649e9512968a44c53a5ce2700a4a0bf68d662bf817a` (`node24.json`) and `37cda6e13fa5fbaa4be7222a511d5953a1aa5f1a3d1b7f03485d1b4f9a23701d` (`summary.json`).

The same producer passed the complete isolated local-registry flow with 22/22 gates under both runtimes. Its mode-`0600` reports have SHA-256 `fab353b0bbf7a845f8be347005c40296f9dfe8dba084b3c4dd3804f538ae35bc` for Node `v22.13.0` and `ea65cc88de4fc950fabd62ab64cd3cc1746f9d1788f8f27c677e3438a808522a` for Node `v24.16.0`. The consumer and candidate remained clean and external sentinels remained intact.

Four fresh raws were then generated serially from producer tree `b213f5b1…` against the clean external project commit `a86fffb15ad21912a87583c2d498f813c47aa27e`, tree `9c359690b58867e01750905b76b1c0cca3ad15a2`. Every member used 20 warm reads, three restarts, the fixed five-call workload, schema 2 and all 42 promotion gates true. The closed-set freezer published exactly four canonical members atomically to the previously absent `production-readiness-sqlite-default-v3` directory. A diagnostic invocation from a different clean clone first failed closed on the raw-bound project/workload identity and published nothing; the single invocation from the exact raw-bound producer path succeeded. The directory is mode `0700`; every checked member is a regular single-link file mode `0600`.

| Checked v3 member               | Runtime    | Project            | Checked SHA-256                                                    | Raw SHA-256                                                        |
| ------------------------------- | ---------- | ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `ast-mcp-server-node22.13.json` | `v22.13.0` | `[ast-mcp-server]` | `7b2df924a0cba4e035ad8ebcf39474323461ce3632a3a28780ec6767eebf3304` | `2c863a054034d8ef89f6e54926f214d4eb711fd94eef04c3daf4e3e1753a7e12` |
| `ast-mcp-server-node24.json`    | `v24.16.0` | `[ast-mcp-server]` | `a10d8431da26c40f350b998116d126010f89326fd4efa2d0aad262a80c4ce23b` | `03c8fbc666d963a189aa7c14565c702ff2d8ad5447fd73e0bee66f319d7f5716` |
| `x-scraper-node22.13.json`      | `v22.13.0` | `[x-scraper]`      | `cce942c38976765936af65ed24d4b8ed49809c47482e217992312a411c13fcf5` | `dc50e3828f7fb0132b2752bd5a98594239f6399d76944068eb6e8b1e7d09bfa4` |
| `x-scraper-node24.json`         | `v24.16.0` | `[x-scraper]`      | `c9c61c66a33fb2c9a8a1f7a3fddcddbe0c2ba975665ef325df50a508e5c53089` | `e0389a21431870d037dd0f57879039ab8b2f8431ad85e24235d0daa379b24865` |

Independent post-freeze parsing recomputed each embedded raw digest, found all 42 top-level promotion gates and all 102 recursively enumerated gate booleans true, and found no host path in checked bytes. Historical v1/v2 directories were not modified.

The first 58-path report sibling materialized as clean synthetic commit `ed19c0f958c0c6f55baedb752b893ec0056f48fc`, tree `1cc27436267694384c21017c564b0a4640d4ee5d`, parent `8f5489e0a066659fa903b2ad2cc69be00eaa48ec`; its baseline-to-tree path manifest SHA-256 is `c15cd424c809330ffdd788adb1ca95ab686e02703bc5ccafb096b3ab7a28d0ac`. The code-producer-to-sibling delta is exactly the four v3 reports, byte-equal to the frozen set. Immutable install/build passed. An operator-added `umask 0077` first matrix attempt failed in mode-preservation assertions. The later matrix under host `umask 0002` passed 15/15 under both runtimes, but Review A correctly rejected that rerun as insufficient causal evidence. Independent reproduction showed one fixture precondition had been filtered by umask and, more importantly, OpenCode replacement staging did not restore the preexisting mode after creation; the permissive-umask PASS had hidden a product defect. Tree `1cc27436…` and its later green matrix are therefore historical, not promotion evidence. Its mode-`0600` report SHA-256 values remain `8acefc667ced0b5d6bffcad5e30f3eb519308dcc6f4229786ce34620f83f7328`, `b5a0b1cdaebcf9780b3be22818a337d46e8c61fa27b4b29400affc366cb9f23d` and `ef4803c195091b7a738ea5d50c6b55f07d5f5210903ce5179a21e74c787d9a5d`.

### Rejected Review A over the v3 report sibling

The post-documentation candidate was clean synthetic commit `f707343dee0287f8a7e29785830a0ac17b70249e`, tree `124bfc6be0f1855aa0497566822127c03fe68677`, parent `34f6a8eeb52acf9bd082cbdff7fc450ccea8abe0`, with 58 exact paths and manifest SHA-256 `c15cd424c809330ffdd788adb1ca95ab686e02703bc5ccafb096b3ab7a28d0ac`. Its fresh matrix passed 15/15 commands in each runtime, but independent Review A did not approve the candidate:

1. Specification/compliance returned `PASS`, complete coverage and zero findings.
2. Security/failure-boundary review returned `REQUEST_CHANGES`, complete coverage and four Medium findings: exported open-schema terminal-report authority; durable propagation of untrusted failure text; incrementally visible partial matrix output; and package-created SQLite directory modes filtered by restrictive umask.
3. Whole-candidate review returned `REQUEST_CHANGES`/incomplete coverage after identifying premature local-registry PASS publication and the unproven permissive-umask rerun; its final Git reauthentication was denied by the execution gateway. Incomplete coverage is not a PASS and does not override the specific observations.

The successor remediation keeps terminal report construction private and branded, uses exact closed schemas and bounded failure codes, publishes one private complete matrix directory atomically/no-replace, normalizes package-created SQLite directories descriptor-bound to `0700`, publishes local-registry PASS only after server/root cleanup, and preserves OpenCode modes independently of umask. The freezer target advances to immutable sibling `v4`; `v3` remains byte-identical rejected-candidate evidence.

### Successor v4 code producer and frozen cohort

The fresh code producer is clean synthetic commit `b67f1272dae0d3cb2a1e08a32a3803ce95cf6b27`, tree `ec915c920b23446050e9d9780a3d024dc123eeb8`, parent `34f6a8eeb52acf9bd082cbdff7fc450ccea8abe0`, with 56 exact baseline-delta paths. Its manifest SHA-256 is `4a721c6cba7db4887efc70d7febd0d6f9a02ae8fcb5cea53c45dad42c6b7c569`; its complete `git ls-tree -rz` ledger SHA-256 is `4cf075bb0089ed38522f53d598c0e0b474a9d76d86371e066e47ac6cba0e6c1b`. The source and candidate indexes remained `1eb1256f98f315054ded2cf14a3dd42ca48589a7`; neither was staged.

Before candidate materialization, fresh private-`HOME`/`TMPDIR` source gates under `umask 0077` passed format, typecheck, all 698 tests and build in Node `v22.13.0`, then format, lint, typecheck, all 698 tests and build in Node `v24.16.0`; `git diff --check` passed. The code-producer release matrix then passed all 15 commands in both runtimes and published one atomic `0700`/`0600` set:

- Node 22.13 report: `9cec4e5d03e80e960d92b5e70913720442229378ddbf88831b6bc1ed96e87396`
- Node 24 report: `b8ec1a6098a85994d78b660739ac45c381e62303a6e3af57c50eacf30f5fe97c`
- summary: `8b3204928e448441687d8a10617f16459f4897d06d07dd84144a8bd1de061808`

A fresh final local-registry run passed all 22 gates in each runtime; report SHA-256 values are `fab353b0bbf7a845f8be347005c40296f9dfe8dba084b3c4dd3804f538ae35bc` for Node 22.13 and `ea65cc88de4fc950fabd62ab64cd3cc1746f9d1788f8f27c677e3438a808522a` for Node 24. Two prior roots failed before valid dual-runtime evidence because the private Yarn authority lacked execute permission; a third root produced a valid Node 22 consumer report but the outer verifier queried a nonexistent `check_count` field. None was reused. The final `v17d` root used fresh outputs and exact runtime-matched executable wrappers.

Four fresh raw canaries bound to commit/tree `b67f1272…`/`ec915c92…` and clean external x-scraper commit/tree `a86fffb15ad21912a87583c2d498f813c47aa27e`/`9c359690b58867e01750905b76b1c0cca3ad15a2` passed. An earlier invocation used obsolete CLI flags and produced no report; its root and names were superseded. Authoritative raw SHA-256 values are:

- ast-mcp-server Node 22.13: `b8afd509a11750aa763b95d00817c58de2165bd7919c6d2403d38493acce725d`
- ast-mcp-server Node 24: `f8b9dec494958cd8179307127fae59e75d2fa2a75bffb14ba709cec3aaf3abfd`
- x-scraper Node 22.13: `1cc2346c44c3cfbfeab97b1c8e9f471de8cdb599ad605f85990b44f93caa24be`
- x-scraper Node 24: `18a7c3fccb30e04200b2387fcf5dadb72720bde3c753a5243ac7fe6c22fd1ad3`

The governed freezer published exactly four `v4` checked files as one no-replace `0700` directory with `0600`, single-link members. Their SHA-256 values are `70ca1e022bdb3bab49c7c8213e898b9b784fbde98ba81964aebc178d548139c4`, `0c4187213a91486b7cf258ece4f3189be5e394616d55fd7b1679fb9f5c609638`, `ef11a07a78adf57d106287d6f2ee2aab08d9b4d22a7b60251b3c7575ba4e899d` and `62a3433832ec795f4d242888243081dded5251df1baa8ea7b42f777210e10c0b` in canonical member order. The historical `v3` members stayed byte-identical at `7b2df924a0cba4e035ad8ebcf39474323461ce3632a3a28780ec6767eebf3304`, `a10d8431da26c40f350b998116d126010f89326fd4efa2d0aad262a80c4ce23b`, `cce942c38976765936af65ed24d4b8ed49809c47482e217992312a411c13fcf5` and `c9c61c66a33fb2c9a8a1f7a3fddcddbe0c2ba975665ef325df50a508e5c53089` in the same member order; `v1` and `v2` also remained unchanged.

### Rejected Review A over the v4 documentation/report sibling

The final v4 documentation/report sibling materialized as clean synthetic commit `8c8182f8096f2c318511cccc52b9a61f6014b1db`, tree `d80d4095abba66c65a94734be5364bd802237a11`, parent `34f6a8eeb52acf9bd082cbdff7fc450ccea8abe0`, with 64 exact paths. Its manifest SHA-256 is `8aa876da457075eaff5f6f09f75d7422b5f7485207ec9c9ff2fb28a3ece192c7`; its immutable owner-ledger SHA-256 is `476df6459ad1685f97d2e75e1e1df17c73e042cd5fa0dc0c98afd2b036f90ecb`. Its fresh exact-tree matrix passed 15/15 commands in both runtimes and its local-registry consumer passed the then-declared 22/22 gates in both runtimes.

Replacement Review A `deleg_837d8e50` authenticated that exact tree at entry and exit:

1. Specification/compliance returned `PASS`, complete coverage and zero findings.
2. Whole-candidate quality/compatibility returned `PASS`, complete coverage and zero findings.
3. Security/failure-boundary returned `REQUEST_CHANGES`, complete coverage and one Medium finding. The local-registry harness copied ambient `PATH`, invoked bare Yarn/npm, authenticated only the parent Node version, and did not bind package-manager path/version/digest or transitive Node identity to its PASS report. The two sibling PASS verdicts remain valid historical reviews of `d80d4095…` but cannot approve changed bytes or override the specific security finding.

The successor remediation requires absolute Yarn/npm JavaScript entries and validates Node/Yarn/npm as canonical, physical, owner-controlled, single-link files with non-writable group/other modes, expected versions and SHA-256 digests. Yarn and npm execute only as arguments to the authenticated Node binary; ambient `PATH` is replaced by a fixed closed policy. The harness compares caller-supplied expected Node/Yarn/npm SHA-256 values, hashes each authority through the same `O_NOFOLLOW` descriptor it authenticates, forces manager child-process resolution through a private directory containing only a separately authenticated Node binary, records its actual digest, reauthenticates all four files before PASS publication, and has negative tests proving injected Yarn/npm/Node shims cannot run. The no-replace freezer advances to `v5`; `v4` remains byte-identical rejected-Review-A evidence.

Focused remediation review `deleg_0959a21f` returned `PASS`, complete coverage and `critical=0`, `high=0`, `medium=0`, `low=0`. It independently confirmed expected digests, descriptor-bound no-follow hashing, private transitive-Node binding, actual bounded evidence, hostile child-Node tests and immediate pre-publication reauthentication. This scoped PASS closes the prior M1 but does not replace whole-candidate Review A.

The fresh 56-path code producer is synthetic commit `b01197bcab3a4ab702fc5ae60ec8a8a91ddcca7f`, tree `d73bd348afe2f4db68950c95e392578c365baab0`, parent `34f6a8eeb52acf9bd082cbdff7fc450ccea8abe0`. Its manifest SHA-256 is `4a721c6cba7db4887efc70d7febd0d6f9a02ae8fcb5cea53c45dad42c6b7c569`; its tree-ledger SHA-256 is `64b2835dee5a83810108b0ab4a6bf90f5874e5faf03804a3aa6b1881fb14bdb3`. Source gates under `umask 0077` passed format, typecheck, all 701 tests and build in Node `v22.13.0`, then format, lint, typecheck, all 701 tests and build in Node `v24.16.0`; `git diff --check` and the empty source index passed.

The producer matrix passed 15/15 in both runtimes. Atomic mode-`0600` report SHA-256 values are `7a1caacf03ef1104931cb0aac262ed16e759906b756c6f115398fbbc4099e65c` (Node 22.13), `716004305bd7068e44409de4d6331d31c6366ddd29214908d3876eeb146d3a07` (Node 24) and `b5b7e5af90119ced77c5cf606cc41720944706eb23a9d2a192befce24623efca` (summary). The exact producer then passed all 23 local-registry gates in both runtimes under `private_authenticated_node_only`; report SHA-256 values are `c78271015a153b9ec773b52f65ec88f8e39587c6faf42fd1fa5ecb72aa76ccec` and `621cd42da10348457a4ed48c8c719bedce8ad15664268138bc9e29906c25fac8`.

Four producer-bound raws passed 42/42 gates with 20 warm reads and three restarts. Raw SHA-256 values in canonical member order are `09123ab2dc381f7b7872686e184555b2fb874458d274296034217775eee77813`, `e368d4cef69aaba440e62fad1cb5917ac1cf721456c0f63595fccd0a2215e819`, `31dcc931e5b7d18381a45968730fd7d053de05292bd747513d26c5f917846633` and `d3ef6d59cae9805c962fb7ae55af580169e7156ff848ec83b3e1f9233e05b166`. The exact raw-bound freezer published `production-readiness-sqlite-default-v5` no-replace; the source projection is one `0700` directory with four `0600`, single-link members. Checked SHA-256 values in canonical member order are `d3ca80450d3d8d0f05a51ca33c8224563fef46da6392b4ff1c6c5cf2ac386bb6`, `a6dd6577b0713a90665e5f08fd38d1d77958858ad214373b031eadcb4014f7bf`, `7e86a1733774639b02806db2973c4be01f86dd5b13711e0e7434aa5013c88760` and `268bf48ab6e2668bc127af197158637f5bc9569ab226f701064b4b0a8c19cefa`.

This verification/task reconciliation remains non-terminal until the final v5 documentation/report sibling, its complete matrix and consumer, and replacement whole-candidate Review A are externally authenticated. The self-referential final candidate identity belongs in the external owner ledger; recording it here before review would mutate the reviewed tree.

### Other focused and packed evidence

Observed before this document was written:

- Baseline `34f6a8eeb52acf9bd082cbdff7fc450ccea8abe0` was clean-materialized separately; its default-disabled `test/symbol-index-policy.test.ts` passed 5/5 on Node `v24.16.0`. External transcript SHA-256: `4c40f57910473e5eb79d9f594c1ed753d2d4d09fbccb774d919089f05a5becce`.
- `scripts/package-smoke.mjs`: PASS on Node `v24.16.0` and exact Node `v22.13.0`.
- `scripts/cli-smoke.mjs`: PASS on both runtimes.
- `scripts/benchmark-symbol-index-integration.mjs`: PASS on both runtimes with 20/20 gates, including private default root/database modes plus bounded inspect/recognized-only clear and unknown-file preservation. Diagnostic reports: `/tmp/ast-index-integration-promote-node24-r2.json` and `/tmp/ast-index-integration-promote-node22-r2.json`.
- Release-preflight tests: 41/41 on both runtimes.
- Local-registry unit tests: 10/10 on both runtimes, including hostile Yarn/npm/transitive-Node execution, expected-digest mismatch and unsafe authority-file rejection.
- Canary/freezer v5 tests: 27/27 on both runtimes, including the narrow formatter exclusion for canonical checked-report bytes.
- Release-candidate matrix contract tests: 29/29 on both runtimes, including ambient-cache creation, closed-schema authority, atomic report publication and sentinel-replacement negatives.
- A Node 24 full-suite diagnostic ran 679 tests: 678 passed and one documentation-policy assertion failed. `SECURITY.md` was aligned with the closed wording and the focused workflow-policy suite then passed 17/17. Because that edit occurred after the full run, no full-suite PASS is claimed here.
- `git diff --check` passed after the focused repairs.

## Exact-tree acceptance ledger

Historical predecessor ledger against package tree `d8defeb72e11091e562e820b69132c949533b218`:

1. Four fresh schema-2 raws were generated from one package tree and one authenticated x-scraper tree.
2. Both runtimes performed 20 warm reads, three restarts and 42/42 passing gates per repository.
3. Every PASS raw self-validated against the then-current freezer contract before its exclusive checked write.
4. Exactly four members were published atomically to `benchmark/results/production-readiness-sqlite-default-v1`, but the checked files were mode `0644`; this predecessor does not satisfy final readiness.
5. Raw and checked digests, candidate identities, complete gates and absence of secret/host-path markers were recomputed after publication.

## Review A result and recovery

Review A authenticated the clean synthetic candidate below at both entry and exit:

- commit: `a737e5ab5819972fcf3f60b93014d79ee3d578e5`;
- tree: `a3ab5c89c191a63335156dd473e831e3e232ad09`;
- parent/base: `34f6a8eeb52acf9bd082cbdff7fc450ccea8abe0`;
- owned manifest: 58 exact paths, SHA-256 `df486f9b5dfe80c3d394454255fb8646d066c6b6a27f7ab499522e0c2446e822`;
- owner ledger SHA-256: `ba0aa9f557086ab4a18cfca3e4eb28b055c3ac06f015acb258f9aa6101a4b2c5`;
- object `git diff --check`: PASS.

Terminal independent verdicts:

1. Specification/compliance: `REQUEST_CHANGES`, `medium=1`. The requirement table shifted declared IDs and introduced undeclared IDs, so it was not authoritative.
2. Security/failure boundaries: `REQUEST_CHANGES`, `high=1`, `medium=1`. Cleanup did not retain a group activity guard across WAL/SHM/main deletion; accepted directory ancestry and pathname reopen also left an untrusted-write/TOCTOU boundary.
3. Whole-candidate quality/compatibility: `NOT_COMPLETED`, zero asserted findings. A blocked read-only extraction plus the eight-call ceiling prevented complete independent coverage; this is not a PASS and cannot be promoted through sibling evidence.

The current remediation adds direct RED/GREEN assertions, trusted ancestry, descriptor-bound Linux SQLite open, group-scoped exclusive cleanup locking and corrected 15-ID traceability. Those bytes invalidate `a3ab5c89…` as a final candidate.

Remediation worktree gates after the final source/test bytes:

- exact Node `v22.13.0`: focused storage/cache 54/54, complete Vitest 686/686, typecheck PASS; the only runtime warning was the declared `node:sqlite` experimental warning;
- Node `v24.16.0`: focused storage/cache 54/54, complete Vitest 686/686, lint/typecheck/format-check PASS;
- no report, candidate-tree or independent-review claim is derived from these mutable-worktree runs.

External pre-dispatch obligations for the frozen verification bytes:

1. Materialize one successor 58-path candidate containing the exact final task/verification bytes and the byte-identical v3 set.
2. Rerun the complete 15/15 matrix under both exact runtimes on that successor and authenticate clean initial/final identity plus report modes.
3. Freeze an external owner ledger for that exact successor without editing repository bytes afterward.
4. Obtain replacement whole-candidate Review A with zero unresolved Medium-or-higher findings and complete independent whole-candidate coverage.
5. Only after PASS, apply the predeclared archive closure delta, rerun its declared gates and obtain Review B before any authorized source-repository commit.

Any source, test, harness, documentation, task or checked-report byte change invalidates later exact-tree evidence and requires a successor sibling.

## Release decision

**Not release-ready.** The v4 exact-tree candidate remains historical. The focused remediation review is complete PASS, and the fresh producer-bound v5 matrix, consumers and checked cohort are green. Release readiness remains blocked until the final documentation/report sibling is materialized, its complete dual-runtime matrix and consumer pass from gate one, replacement whole-candidate Review A returns complete PASS with zero Medium-or-higher findings, and the separately reviewed archive/commit transitions are authorized.

No stage, commit, push, npm publication, dist-tag mutation, Git tag, hosted release or public-registry readback was performed.

## Residual risks and deferred scope

- Native `node:sqlite` remains an active-development API on the lower runtime; capability checks, compiler fallback and explicit `disabled` are the mitigation.
- Verified support is Linux x64 with the documented ownership/no-follow/inode/procfs/GNU primitive boundary. Other systems are unverified.
- A malicious same-UID process is outside the local cache threat model.
- Automatic cache GC is intentionally deferred until usage/age telemetry exists; operator inspect/clear is the supported lifecycle.
- SQLite remains a derived projection, never mutation or semantic authority.
- Public npm signatures, provenance, registry integrity and installed public-consumer verification are post-publication transitions and were not exercised locally.
- Existing historical `benchmark/results/production-readiness` reports remain immutable point-in-time evidence and are not promotion evidence.
