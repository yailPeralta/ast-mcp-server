# Verification: productive symbol-index persistence integration

Date: 2026-08-07

## Decision boundary

- The default remains `AST_SYMBOL_INDEX_PERSISTENCE=disabled` and selects memory-only.
- `canary` is the only SQLite opt-in in this phase and requires an absolute normalized cache root.
- Reserved `enabled` fails closed to `disabled`/memory-only with reason `enabled_not_released`; it does not open SQLite before the ADR gate.
- The compiler/project remains the semantic authority. The persisted index is a derived, body-free read projection.
- `prepare` and `apply` do not open or depend on the persistence backend.
- Immediate rollback is `disabled` plus session invalidation/reopen; existing cache files are left untouched and unopened.
- ADR 0009 changed only after the final read-only adversarial review returned `PASS`; it authorizes explicit canary while retaining disabled/memory default and rollback.

## Prior adversarial review

The first frozen-tree review returned `REQUEST_CHANGES`. Its report is:

`<hermes-cache>/delegation/subagent-summary-0-20260807_100641_640389.txt`

The candidate was not approved after that review. A later review of a subsequent but now stale tree also returned `REQUEST_CHANGES`:

`<hermes-cache>/delegation/subagent-summary-0-20260807_111550_716689.txt`

A third review, dispatched before the final constraint/status remediation, also returned `REQUEST_CHANGES`:

`<hermes-cache>/delegation/subagent-summary-0-20260807_111820_539774.txt`

A fourth review of the subsequent pre-remediation tree returned `REQUEST_CHANGES` for self-consistent projection omissions, migration snapshot atomicity, unbounded SQLite reads and overstated evidence:

`<hermes-cache>/delegation/subagent-summary-0-20260807_121339_378103.txt`

A fifth review of the next frozen tree returned `REQUEST_CHANGES` for post-materialization limits, canonical suppression by rejected cleanup/report callbacks, missing non-contention COMMIT evidence, and capability ordering:

`<hermes-cache>/delegation/subagent-summary-0-20260807_130340_792371.txt`

None of those verdicts is treated as approval. Each reviewed an older tree. The following table records remediation on the current tree.

| Finding                                                  | Current-tree remediation and evidence                                                                                                                                                                                                                                                                                                                                                                                                          | Result |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Query/read errors were swallowed                         | Indexed consumers report typed failures to the project session; fallback closes SQLite, swaps to memory, records `read_failure`, and compiler search continues. `test/project.test.ts`, `test/context-builder.test.ts`, `test/mcp.integration.test.ts`.                                                                                                                                                                                        | PASS   |
| `flush()` was a no-op and unused                         | SQLite `flush()` performs `PRAGMA wal_checkpoint(FULL)`, detects blocked checkpoints, and project refresh calls it. Unit contention and same-operation project fallback are covered.                                                                                                                                                                                                                                                           | PASS   |
| Schema creation was not transactional                    | Schema creation runs in `BEGIN IMMEDIATE`/`COMMIT`, rolls back on failure, classifies `write_failed`, and reopens cleanly. `test/symbol-index-sqlite.test.ts`.                                                                                                                                                                                                                                                                                 | PASS   |
| Migration/integrity guarantees were incomplete           | Schema v2 validates ordered names, declared types, `NOT NULL`, defaults, PK positions and SHA-256 projection checksums; migration acquires `BEGIN IMMEDIATE` before metadata/row reads and retains it through constrained-v2 rebuild/commit; a second real connection is blocked during the snapshot and succeeds after migration; negative/future versions and malformed payloads fail safely; `PRAGMA integrity_check` runs before exposure. | PASS   |
| Invalid/corrupt stores were retried without quarantine   | Relevant open/read/schema/corruption failures close the store, quarantine the derived file, remove WAL/SHM sidecars, and rebuild from compiler/memory.                                                                                                                                                                                                                                                                                         | PASS   |
| Index status was forced to `disabled`                    | Durable state now preserves `disabled`, `ready`, `rebuilding`, and `failed`; 53 project-status state-machine tests pass.                                                                                                                                                                                                                                                                                                                       | PASS   |
| Read/write operation vocabulary and counters diverged    | `read_failure` and `write_failure` are explicit; counters use a saturating bound of 1,000,000; malformed values fail bounded.                                                                                                                                                                                                                                                                                                                  | PASS   |
| Mutation isolation lacked regression evidence            | Canary-configured `prepare`/`apply` creates no cache directory and retains reviewed hash enforcement, diagnostics, blocked state, affected files, and apply guards. `test/operations.test.ts`.                                                                                                                                                                                                                                                 | PASS   |
| Memory store exposed mutable references                  | Loads and query results are defensive copies; mutation-isolation regression is in `test/symbol-index.test.ts`.                                                                                                                                                                                                                                                                                                                                 | PASS   |
| Persisted metadata was not fully compiler-validated      | Candidate name, symbol path, signature, selector, kind, line, and range start are checked against the canonical declaration; forged metadata falls back.                                                                                                                                                                                                                                                                                       | PASS   |
| Cache path symlink escape was possible                   | Missing directories are created one component at a time after `lstat`; symlink/non-directory ancestors and symlinked database targets are rejected before an outside suffix is created.                                                                                                                                                                                                                                                        | PASS   |
| Open/load/query/migration work was effectively unbounded | Both stores reject direct limits outside `1..10,000`, return at most 10,000 candidates and inspect at most 10,000 selected entries/50,000 symbols. SQLite reads only the 16-byte header, pushes file filters into SQL, uses bounded 32-row `LIMIT/OFFSET` pages on Node 22.5/24, rejects rows above 4 MiB before parse and caps aggregate projection payload at 64 MiB. Over-capacity scans use compiler fallback.                             | PASS   |
| Valid-looking rows could omit every symbol               | The SHA-256 digest is treated only as exact-byte integrity. Indexed queries compare the full ranked result with canonical compiler search; empty/partial projections with a recomputed digest fail `corrupt_storage`, await quarantine/fallback and return compiler symbols in the same operation. Current-schema forged-empty, migrated-empty and benchmark regressions cover this path.                                                      | PASS   |
| `ast_explore` retained stale same-operation freshness    | Indexed query failure returns the effective fallback context; evidence and freshness are computed from that context. The regression requires `degraded` plus `index_failure` in the same response.                                                                                                                                                                                                                                             | PASS   |
| `enabled` opened SQLite before the ADR gate              | Policy now fails closed with `enabled_not_released`; policy tests and both integration reports verify it.                                                                                                                                                                                                                                                                                                                                      | PASS   |
| Same-column SQLite tables could weaken constraints       | `PRAGMA table_info` validation now rejects incompatible type/nullability/default/PK contracts; a direct same-name/no-PK regression fails with `unsupported_schema`.                                                                                                                                                                                                                                                                            | PASS   |
| Fail-closed policy reason was absent from public status  | `index_observability.policy_reason` is a closed public literal, session policy identity includes it, MCP schema exposes it, and project/benchmark regressions require `enabled_not_released`.                                                                                                                                                                                                                                                  | PASS   |
| Runtime/package evidence was incomplete                  | The same benchmark passes on Node 24 and Node 22.5 with the required experimental flag; MCP, CLI, package, audit, and pack gates pass.                                                                                                                                                                                                                                                                                                         | PASS   |
| Bounds ran after parse/map/copy/serialize                | Collection lengths are rejected before map/copy; persisted JSON arrays are structurally counted against the remaining symbol budget before `JSON.parse`; exact escaped projection bytes are computed before complete serialization. Regressions assert zero element reads, exactly 50 bounded parses for a 50,001-symbol scan, zero oversized `JSON.stringify` calls and exact Unicode/escape accounting.                                      | PASS   |
| Cleanup/report errors could suppress canonical results   | Query consumers absorb rejected failure callbacks after canonical computation. Session fallback installs memory/failed before best-effort close; a throwing close cannot reject the fallback. Write failure rebuilds every memory projection from compiler symbols instead of applying a changed-only plan to an empty store. Direct project regressions cover all three paths.                                                                | PASS   |
| No real non-contention write-failure gate                | A real `DatabaseSync` wrapper throws only on transaction `COMMIT`; unit and benchmark probes require `write_failed`, rollback, prior-state preservation and failed-state absence after reopen. The session leg additionally requires memory/failed, compiler symbol return and `write_failure_count=1` in the same operation. The benchmark exits non-zero if any gate is false.                                                               | PASS   |
| Capability failure happened after filesystem work        | `DatabaseSync` capability is resolved before cache-directory creation or target/header inspection. A nested-missing-root regression injects absent capability and proves no directory is created.                                                                                                                                                                                                                                              | PASS   |

## Requirement traceability

| Requirement                                                   | Evidence                                                                               | Result |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------ |
| Compiler authority and canonical candidate validation         | `test/project.test.ts`, `test/context-builder.test.ts`, `test/mcp.integration.test.ts` | PASS   |
| Disabled default and reserved `enabled` fail-closed           | `test/symbol-index-policy.test.ts`, `test/project.test.ts`, both integration reports   | PASS   |
| Changed-only extraction, reuse, config invalidation, deletion | `test/symbol-index.test.ts`, `test/project.test.ts`, benchmark scenarios               | PASS   |
| Common memory/SQLite store contract                           | `test/symbol-index-store-conformance.test.ts` (10 tests)                               | PASS   |
| SQLite persistence, reload, isolation, body-free rows         | `test/symbol-index-sqlite.test.ts`, conformance suite                                  | PASS   |
| Transactional schema, migration, integrity, close/reopen      | `test/symbol-index-sqlite.test.ts` (23 tests)                                          | PASS   |
| Corruption quarantine and sidecar cleanup                     | SQLite/project tests and benchmark corruption scenarios                                | PASS   |
| Query/read and refresh/flush fallback                         | `test/project.test.ts`, benchmark `read_failure` and `flush_failure`                   | PASS   |
| Bounded contention and candidate reads                        | SQLite/symbol tests and benchmark contention gates                                     | PASS   |
| State and bounded observability                               | `test/project-status.test.ts` (53 tests), policy/project/MCP tests                     | PASS   |
| Mutation isolation                                            | `test/operations.test.ts` (21 tests)                                                   | PASS   |
| Runtime/package compatibility                                 | Node 24/22.5 reports, MCP/CLI/package smokes                                           | PASS   |

## Exact verification commands

All commands ran from `<repository-root>`.

### Focused checks

```text
yarn typecheck
yarn test test/symbol-index.test.ts test/symbol-index-sqlite.test.ts test/project.test.ts test/context-builder.test.ts test/mcp.integration.test.ts
```

Results:

- Final authority/lifecycle/consumer focused set: PASS, 5 files and 73 tests.
- SQLite plus common-store compatibility set after bounded paging: PASS, 2 files and 33 tests.

### Integration benchmark

```text
yarn benchmark:index-integration --output /tmp/ast-symbol-index-integration-remediation2-final-node24.json
PATH=<node-22.5-bin-directory>:$PATH \
  NODE_OPTIONS=--experimental-sqlite \
  yarn benchmark:index-integration \
  --output /tmp/ast-symbol-index-integration-remediation2-final-node22.5.json
```

Both reports returned `status: ok` and all 15 gates are `true`:

- `default_disabled`
- `canary_persisted`
- `incremental_changed_file`
- `corruption_quarantined`
- `corruption_recovered`
- `forged_projection_quarantined`
- `rollback_memory_only`
- `unsupported_capability`
- `enabled_fails_closed`
- `read_failure`
- `invalid_path`
- `migration_failure`
- `non_contention_write_failure`
- `bounded_contention`
- `flush_failure`

Failure classifications are identical on both runtimes:

- unsupported capability → `capability_unavailable`
- read failure → `read_failed`
- invalid path → `invalid_path`
- migration interruption → `migration_failed`
- non-contention COMMIT failure → `write_failed`, rollback/reopen preserved, same-operation memory/compiler fallback
- writer contention → `contention`
- blocked checkpoint → `contention`

Runtime identities:

- Node `v24.16.0`
- Node `v22.5.0` with `--experimental-sqlite`

Durations are local observations over a deterministic synthetic fixture and are not SLAs.

### Full quality and distribution gate

```text
NODE_OPTIONS= yarn test
yarn format:check
yarn lint
yarn typecheck
yarn build
yarn test:mcp
yarn test:cli
yarn test:package
yarn audit
yarn pack --dry-run --json
git diff --check
```

Results:

- Full test suite: PASS, 32 files and 271 tests.
- Format, lint, typecheck, build, and diff check: PASS.
- MCP smoke: PASS, stdio, 15 tools.
- CLI smoke: PASS, persisted apply, contention, replay, skill installation, and setup.
- Package smoke: PASS, version `0.6.0`, engine `>=22.5.0`, lifecycle scripts disabled, global install and idempotent targets.
- Audit: PASS, no suggestions.
- Pack dry-run: PASS, 57 files; built symbol-index SQLite, policy and limits modules are included.

Pack output: `/tmp/ast-pack-symbol-index-remediation2-final.json`.

## Current ADR gate

Implementation, runtime, fallback, package, rollback and adversarial-review gates are green. All five prior `REQUEST_CHANGES` verdicts apply only to stale trees. The definitive closure review returned `PASS` for candidate digest `c3d2d8ed11200562066eeb295e0426fa8e221d0ada5a2577771ee627fd7fd9d1`; its report is:

`<hermes-cache>/delegation/subagent-summary-0-20260807_135715_481002.txt`

ADR 0009 now authorizes SQLite only through explicit `canary` opt-in. The default remains memory-only, no global canary is enabled, and reserved `enabled` remains fail-closed.

## Residual risks

- Node 22.5 exposes SQLite as experimental and requires `NODE_OPTIONS=--experimental-sqlite`.
- Portable/WASM SQLite remains deferred; no dependency is installed implicitly.
- Broad index scans inspect at most 50,000 symbols and return at most 10,000 candidates. Exceeding the scan cap abandons the index for complete compiler search rather than returning a truncated ranking.
- SQLite is a derived cache. Loss, quarantine, or rollback may cost rebuild time but cannot weaken mutation checks.
- Benchmark timings are local synthetic observations, not production capacity claims.
- No credential, token, connection string, source body, host cache path, or secret appears in public status or these reports.
