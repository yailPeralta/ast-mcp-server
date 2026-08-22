# Apply Progress: Expose Compiler-Backed Affected Test Candidates

## Execution Context

- Artifact store: hybrid
- Mode: Strict TDD
- Delivery: approved feature-branch chain
- Current slice: PR3 batch, documentation, managed skill metadata, and final verification
- Public surface: 16 tools with one compiler-backed candidate implementation
- Previous apply progress: PR1 and PR2 retained in full below

## Cumulative Task Status

- [x] 1.1 Added resolver evidence and convention-bound tests.
- [x] 1.2 Added public error classification, redaction, and bound tests.
- [x] 1.3 Extracted shared relationship schemas, exported convention bounds, and added incomplete-evidence error support.
- [x] 1.4 Preserved impact behavior and completed the PR1 focused gate.
- [x] 2.1–2.4 Added and verified the complete MCP public surface and exact inventories.
- [x] 3.1–3.4 Added and verified batch/CLI parity, documentation, ADR, managed skill metadata, and final gates.

## TDD Cycle Evidence

| Task | Test File                                              | Layer            | Safety Net                                           | RED                                                                                                                  | GREEN                                                                              | TRIANGULATE                                                                                                                                       | REFACTOR                                                                                        |
| ---- | ------------------------------------------------------ | ---------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1.1  | `test/test-candidates.test.ts`                         | Unit             | 37/37 baseline across both focused files             | Genuine RED: missing exported bounds and non-authoritative invariant contributed 2 failures                          | 48/48 focused unit tests passed                                                    | Direct/transitive/custom/proven-empty/atomic-page plus stale, rebuilding, degraded, truncated, unresolved, heuristic, and non-authoritative cases | Shared constraints named and exported; focused gate green                                       |
| 1.2  | `test/public-errors.test.ts`                           | Unit             | 37/37 baseline across both focused files             | Genuine RED: incomplete code, incomplete legacy classification, and convention classification contributed 3 failures | 48/48 focused unit tests passed                                                    | Typed hostile-message and fixed legacy-message paths both covered                                                                                 | Fixed bounded message and narrow legacy mappings; focused gate green                            |
| 1.3  | Both focused unit files                                | Unit             | Existing resolver/error behavior characterized first | Same five RED failures preceded production edits                                                                     | Minimal exports, shared schema extraction, code/mapping additions made all 48 pass | Boundaries exercised with over-count, over-length, sensitive, and oversized values                                                                | `get_impact.ts` now imports one shared schema contract without observable drift                 |
| 1.4  | `test/mcp.integration.test.ts` plus focused unit files | Integration      | Focused unit GREEN established first                 | N/A: verification/refactor task                                                                                      | 66/66 PR1 gate passed outside sandbox                                              | Existing MCP suite preserved the exact 15-tool runtime behavior                                                                                   | Formatting and typecheck passed                                                                 |
| 2.1  | `test/mcp.integration.test.ts`                         | Integration      | 45/45 PR2 baseline outside sandbox                   | Genuine RED: absent tool caused three MCP failures                                                                   | 47/47 GREEN                                                                        | Direct/transitive/custom/proven-empty/incomplete/root/maxima/atomic-page cases                                                                    | Shared schemas and bounded pagination; 47/47                                                    |
| 2.2  | Inventory tests and smoke fixtures                     | Integration      | Existing 15-tool inventories passed                  | Genuine RED: legacy Hermes inventory stayed current                                                                  | 16-tool registration and compatibility passed                                      | Exact MCP, fake-agent, and registry inventories exercised                                                                                         | One synchronized inventory update; smoke green                                                  |
| 2.3  | MCP and inventory files                                | Integration      | RED established before product edits                 | Same four RED failures preceded implementation                                                                       | Adapter, registration, and compatibility made 47/47 pass                           | Defaults and maxima plus custom conventions exercised                                                                                             | One transport adapter; compiler traversal remains service-owned                                 |
| 2.4  | PR2 focused/runtime gates                              | Integration      | GREEN established first                              | N/A: verification/refactor task                                                                                      | Exact PR2 gate and registry consumer passed                                        | Registry package install and stdio inventory independently proved                                                                                 | Prettier, typecheck, and focused rerun green                                                    |
| 3.1  | `test/batch.test.ts`                                   | Integration      | 13/13 batch baseline                                 | Genuine RED: 2 failed and 13 passed because `ast_find_test_candidates` was not admitted                              | 15/15 batch tests passed after one allowlist entry                                 | Injected/conflicting roots, direct/transitive pages, complete paths, JSON, and TOON exercised                                                     | Typed TOON readback and per-run timestamps normalized only for the cross-run smoke comparison   |
| 3.2  | Batch, CLI, README, changelog, and ADR                 | Integration/docs | PR3 RED established first                            | Same two batch failures preceded production admission                                                                | Built CLI used the registered MCP implementation and passed JSON/TOON parity       | Two candidates with one- and two-edge proofs plus authoritative root injection exercised                                                          | Documentation covers compiler authority, fail-closed behavior, parity, pagination, and rollback |
| 3.3  | Managed skill and release manifest                     | Contract         | Verified 4.3.0/0.9.2 digest captured before edits    | N/A: managed documentation metadata                                                                                  | Skill 4.4.0 digest and predecessor manifest readback passed                        | Current digest and exact 0.9.2 predecessor independently checked                                                                                  | Registry refreshed with 21 skills; package smoke validated installed managed assets             |
| 3.4  | Full PR3 gate set                                      | Integration      | Focused GREEN established first                      | N/A: verification/refactor task                                                                                      | 50 files and 718 tests plus every required build/smoke/package gate passed         | MCP, lifecycle, CLI, errors, package, and full suite covered independent runtime boundaries                                                       | Current product-path count is 288 lines across 11 paths, below the 400-line ceiling             |

## Test and Process Evidence

| Stage                      | Command                                                                                          | Exact result                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Safety net                 | `yarn test test/test-candidates.test.ts test/public-errors.test.ts`                              | Exit 0; 2 files, 37 tests passed                                                                           |
| RED                        | `yarn test test/test-candidates.test.ts test/public-errors.test.ts`                              | Exit 1; 2 files, 5 failed and 42 passed; failures matched missing bounds/invariants/error support          |
| Initial GREEN              | `yarn test test/test-candidates.test.ts test/public-errors.test.ts`                              | Exit 0; 2 files, 47 tests passed                                                                           |
| Triangulate/REFACTOR       | `yarn test test/test-candidates.test.ts test/public-errors.test.ts`                              | Exit 0; 2 files, 48 tests passed after the atomic-page characterization                                    |
| Initial focused gate       | `yarn test test/test-candidates.test.ts test/public-errors.test.ts test/mcp.integration.test.ts` | Exit 1 in sandbox; native SQLite fell back to memory and cancellation/mutation integration cases cascaded  |
| Authoritative focused gate | Same command outside sandbox                                                                     | Exit 0; 3 files, 66 tests passed                                                                           |
| Type safety                | `yarn typecheck`                                                                                 | Exit 0                                                                                                     |
| PR2 safety net             | `yarn test test/mcp.integration.test.ts test/agent-targets.test.ts test/agent-setup.test.ts`     | Exit 0 outside sandbox; 3 files, 45 tests passed                                                           |
| PR2 RED                    | Same command                                                                                     | Exit 1 outside sandbox; 4 failed and 43 passed; failures proved missing registration and compatibility     |
| PR2 GREEN                  | Same command                                                                                     | Exit 0 outside sandbox; 3 files, 47 tests passed                                                           |
| PR2 REFACTOR               | Same command                                                                                     | Exit 0 outside sandbox; 3 files, 47 tests passed                                                           |
| PR2 focused gate           | Same command `&& yarn test:mcp`                                                                  | Exit 0 outside sandbox; 47 tests plus 16-tool stdio smoke passed                                           |
| Registry consumer          | `yarn test:local-registry` with pinned Node/Yarn/npm authority arguments                         | Exit 0; packaged candidate, exact inventory, JSON/TOON, SQLite, and mutation gates passed                  |
| PR2 type safety            | `yarn typecheck`                                                                                 | Exit 0                                                                                                     |
| PR2 lint                   | `yarn lint`                                                                                      | Exit 0                                                                                                     |
| PR3 safety net             | `yarn test test/batch.test.ts`                                                                   | Exit 0; 1 file, 13 tests passed                                                                            |
| PR3 RED                    | `yarn test test/batch.test.ts`                                                                   | Exit 1; 2 failed and 13 passed; both failures proved missing read allowlisting                             |
| PR3 GREEN/REFACTOR         | `yarn test test/batch.test.ts`                                                                   | Exit 0; 1 file, 15 tests passed                                                                            |
| PR3 CLI harness            | `yarn test:cli` outside sandbox                                                                  | Exit 0 after normalizing per-invocation `checked_at` in the parity comparison; Bash CLI report status `ok` |
| Formatting                 | `yarn format:check`                                                                              | Exit 0; all matched files use Prettier style                                                               |
| Lint                       | `yarn lint`                                                                                      | Exit 0                                                                                                     |
| Type safety                | `yarn typecheck`                                                                                 | Exit 0                                                                                                     |
| Full tests                 | `env -u GIT_PAGER yarn test` outside sandbox                                                     | Exit 0; 50 files and 718 tests passed                                                                      |
| Build                      | `env -u GIT_PAGER yarn build`                                                                    | Exit 0                                                                                                     |
| MCP smoke                  | `env -u GIT_PAGER yarn test:mcp`                                                                 | Exit 0; 16 tools and default SQLite/TOON/error checks passed                                               |
| Lifecycle smoke            | `env -u GIT_PAGER yarn test:lifecycle`                                                           | Exit 0; EOF/signals/drain/rejection/critical completion and zero-orphan checks passed                      |
| CLI smoke                  | `env -u GIT_PAGER yarn test:cli`                                                                 | Exit 0; candidate JSON/TOON parity and all existing CLI checks passed                                      |
| Error smoke                | `env -u GIT_PAGER yarn test:errors`                                                              | Exit 0; compiled hostile-error and correlation checks passed                                               |
| Package smoke              | `env -u GIT_PAGER yarn test:package`                                                             | Exit 0; tarball, SQLite, install, six agent targets, and idempotency checks passed                         |
| Managed skill readback     | Manifest/digest Node check plus `gentle-ai skill-registry refresh --force`                       | Skill 4.4.0 SHA-256 matched; 4.3.0/0.9.2 predecessor preserved; registry refreshed with 21 skills          |

## Work Unit Evidence

| Evidence                                          | Required value                                                                                                                                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test command and exact result             | `yarn test test/test-candidates.test.ts test/public-errors.test.ts test/mcp.integration.test.ts`; exit 0 outside sandbox; 3 files and 66 tests passed                                                                         |
| Runtime harness command/scenario and exact result | N/A: PR1 is internal-only and does not register or expose a new runtime tool; existing MCP integration is the compatibility harness and passed 66/66                                                                          |
| Rollback boundary                                 | Revert `src/tools/relationship-schema.ts`, the shared-schema import refactor, exported convention bounds, incomplete-evidence support, and their two unit-test changes; no public registration/inventory behavior is involved |

### PR2 MCP public surface

| Evidence                                          | Required value                                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Focused test command and exact result             | Exact PR2 gate; exit 0; 47 tests and 16-tool stdio smoke passed                                                               |
| Runtime harness command/scenario and exact result | Authenticated `yarn test:local-registry`; exit 0 with every registry-consumer gate true                                       |
| Rollback boundary                                 | Revert the adapter, server registration, agent expectation, MCP/inventory tests, and three smoke fixtures; PR1 remains intact |

### PR3 batch, documentation, and managed metadata

| Evidence                                          | Required value                                                                                                                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test command and exact result             | `yarn test test/batch.test.ts`; exit 0; 1 file and 15 tests passed                                                                                                                                                     |
| Runtime harness command/scenario and exact result | `env -u GIT_PAGER yarn test:cli`; exit 0 with candidate JSON/TOON parity through the registered MCP implementation; all final smokes and package gate also passed                                                      |
| Rollback boundary                                 | Revert `src/batch/schema.ts`, `test/batch.test.ts`, `scripts/cli-smoke.mjs`, public docs/ADR/changelog, managed skill/release metadata, and three version assertions; PR1/PR2 compiler and MCP behavior remains intact |

## Diagnosis and Boundaries

- Root gap: convention limits existed only as private constants, relationship evidence schemas were duplicated inside `get_impact.ts`, and public errors lacked a bounded incomplete-evidence code/mapping.
- Harness disposition: the sandboxed MCP run was environmentally invalid because native SQLite could not initialize; an approved outside-sandbox rerun passed the exact same command.
- Scope held: no `ast_find_test_candidates`, server registration, batch allowlist, inventories, smoke fixtures, docs, changelog, ADR, or managed skill metadata changes.
- Cleanup: no temporary repository files were created; unrelated untracked files remained untouched.
- Root gap closed: the internal resolver had no trusted MCP orchestration, registration, or synchronized inventory.
- Harness disposition: sandboxed SQLite/stdio was invalid; exact gates passed outside the sandbox.
- Scope held: batch schema, CLI smoke, docs, changelog, ADR, and managed skill metadata remained PR3-only before this slice.
- Cleanup: temporary registry evidence and private Node authority were removed; unrelated untracked files remained untouched.
- Root gap closed: the registered compiler-backed tool is now admitted to read batches, CLI JSON/TOON parity is exercised, and guidance/release metadata advertise the same public contract.
- Harness disposition: the initial sandboxed CLI gate could not initialize its native cache boundary; the authoritative outside-sandbox run passed. One full-suite launch inherited `GIT_PAGER` and failed its ambient-control preflight; the exact suite passed with that injected variable removed. The parity smoke ignores only per-invocation `checked_at` values and compares all remaining logical evidence exactly.
- Scope held: PR3 reproducibly contains 288 product-path lines across 11 boundary paths: 239 tracked slice additions/deletions plus the 49-line new ADR. It remains within the approved 220–340 forecast and below the 400-line ceiling.
- Accounting reconciliation: native attempt 4 records authoritative `changed_lines: 239`, while its immutable `process_evidence` still says `291 changed lines`; the 3-line difference from the reproducible 288 total is an unresolved accounting-method delta.
- Cleanup: no repository scratch files were created, no Git delivery mutation occurred, and `docs/external-project-opportunities.md` plus `openspec/archive/2026-08-13-improve-agent-setup/verify-report.md` retained their observed hashes.

## Evidence Revision

`24d31126cf41f68a0e85aa79d05b66e7279d6389e7cac1d8e591a8a29db0d489`

## Bounded Verification Remediation: Convention-Driven Reason

```json
{
  "schema": "gentle-ai.remediation-result/v1",
  "lineage_id": "",
  "generation": 0,
  "fix_batch": 0,
  "failed_evidence_revision": "sha256:375cc8d7c3c048ade569898d9586c8b2741891e39ad2fe5f69a8321769b2739e",
  "remediated_evidence_revision": "sha256:dd8e241a1f3a982dce87ca443057cb78de86967db811c03e1b6184b9232f5ba9",
  "outcome": "success",
  "authority": "native-runtime-only-unmanaged"
}
```

```json
{
  "schema": "gentle-ai.remediation-evidence/v1",
  "lineage_id": "",
  "generation": 0,
  "fix_batch": 0,
  "failed_evidence_revision": "sha256:375cc8d7c3c048ade569898d9586c8b2741891e39ad2fe5f69a8321769b2739e",
  "remediated_evidence_revision": "sha256:dd8e241a1f3a982dce87ca443057cb78de86967db811c03e1b6184b9232f5ba9",
  "changed_lines": 41,
  "changed_paths": [
    "src/services/test-candidates.ts",
    "test/test-candidates.test.ts",
    "test/mcp.integration.test.ts"
  ],
  "strict_tdd": true,
  "test_command": "yarn test"
}
```

### Diagnosis and correction

- Failed evidence revision: `sha256:375cc8d7c3c048ade569898d9586c8b2741891e39ad2fe5f69a8321769b2739e`.
- Root cause: candidate eligibility used caller conventions, but `candidateReason()` classified every eligible candidate only by compiler depth; the exported reason enum therefore lacked the required convention-driven public state.
- Correction: add stable public reason `convention_match` and select it only when the eligible candidate does not match the default test patterns or directories. Candidates already recognized by defaults retain `direct_compiler_reference` or `transitive_compiler_reference`, even when caller conventions overlap them.
- Transport propagation: `TestCandidateSchema.reason` already uses `z.enum(TEST_CANDIDATE_REASONS)`, so the shared exported contract updated MCP and batch serialization without a duplicate enum.
- Compiler proof, confidence, depth, relationship identifiers/path, ordering, fail-closed trust, pagination, MCP/batch parity, and the 16-tool inventory were not changed.

### Remediation TDD Cycle Evidence

| Task                     | Test files                                                     | Layer                  | Safety Net                               | RED                                                                                                                      | GREEN                                | TRIANGULATE                                                                                                             | REFACTOR                                                         |
| ------------------------ | -------------------------------------------------------------- | ---------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Convention-driven reason | `test/test-candidates.test.ts`, `test/mcp.integration.test.ts` | Unit + MCP integration | Unit 13/13; authoritative host MCP 20/20 | Unit 1 failed/12 passed; MCP 1 failed/19 passed, both received `direct_compiler_reference` instead of `convention_match` | Unit 13/13 and host MCP 20/20 passed | Custom pattern/directory matches report `convention_match`; overlapping defaults preserve direct and transitive reasons | Minimal implementation retained; combined host gate 33/33 passed |

### Remediation Test and Process Evidence

| Stage         | Exact command                                                                                                   | Result                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RED unit      | `env -u GIT_PAGER -u PAGER yarn test test/test-candidates.test.ts`                                              | Exit 1; 1 failed, 12 passed; output SHA-256 `74105686a3d7e713c9724229b0824b98753e3bcbc6196616cb6547599f779374`                                                                                                                    |
| RED MCP       | `env -u GIT_PAGER -u PAGER yarn test test/mcp.integration.test.ts` outside sandbox                              | Exit 1; 1 failed, 19 passed; output SHA-256 `601f3937fd7518bc7bb9e87f803fd44c25c9ba88d8a4af453218e8ba7022d986`                                                                                                                    |
| GREEN unit    | Same unit command                                                                                               | Exit 0; 13/13; output SHA-256 `a4e347d9337c3b40142f5a9a2830fb8b1020e3d08545ba312376f88135b99f43`                                                                                                                                  |
| GREEN MCP     | Same MCP command outside sandbox                                                                                | Exit 0; 20/20; output SHA-256 `eb7606785987f749f01124ee3c5b8ae152179259738db941838100b7e6ae37ac`                                                                                                                                  |
| REFACTOR gate | `env -u GIT_PAGER -u PAGER yarn test test/test-candidates.test.ts test/mcp.integration.test.ts` outside sandbox | Exit 0; 2 files, 33/33; output SHA-256 `4ee4c02e424a5831ef51d978f64d2be46eb10e395ef4ee8559fa8901f811d268`                                                                                                                         |
| Batch parity  | `env -u GIT_PAGER -u PAGER yarn test test/batch.test.ts` outside sandbox                                        | Exit 0; 15/15; output SHA-256 `5a4f6480ab8cf533a7fa67c090c3f3b20ed097e8407ee3c5c7b7f86b798465ab`                                                                                                                                  |
| MCP inventory | `env -u GIT_PAGER -u PAGER yarn test:mcp` outside sandbox                                                       | Exit 0; exact 16-tool stdio smoke; output SHA-256 `f6992c50347923ee24cd77dd073d4dd5cb8a6750be8cb0eb94f2b0e097f3fb91`                                                                                                              |
| CLI parity    | `env -u GIT_PAGER -u PAGER yarn test:cli` outside sandbox                                                       | Exit 0; batch JSON/TOON and existing CLI gates passed; output SHA-256 `9d2f6885318db97926a1ce153ccfe48ad91391ec2cf7f14bbe6cc4a9534e636b`                                                                                          |
| Type safety   | `env -u GIT_PAGER -u PAGER yarn typecheck`                                                                      | Exit 0; empty-output SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`                                                                                                                                   |
| Lint          | `env -u GIT_PAGER -u PAGER yarn lint`                                                                           | Exit 0; empty-output SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`                                                                                                                                   |
| Formatting    | `yarn format:check` then targeted `yarn prettier --check`                                                       | Global check found only the immutable historical `verify-report.md`; the three remediation product/test paths passed check-only formatting with output SHA-256 `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` |

### Remediation Work Unit Evidence

| Evidence                                          | Required value                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Focused test command and exact result             | Combined unit/MCP host gate passed 33/33 after genuine RED failures in both layers.                                                |
| Runtime harness command/scenario and exact result | MCP custom `**/*.check.ts` result reports `convention_match`; batch 15/15, MCP 16-tool smoke, and CLI JSON/TOON parity all passed. |
| Rollback boundary                                 | Revert only the reason enum/classifier and the two focused test assertions; all prior PR1–PR3 work remains intact.                 |

### Remediation boundaries and revision

- Authority: native-runtime-only unmanaged remediation (`lineage_id: ""`, `generation: 0`, `fix_batch: 0`); no review lineage was invented.
- Correction scope: 41 product/test changed lines across exactly three paths; cumulative artifact additions remain below the 200-line remediation budget.
- Reproducible product revision: SHA-256 of the sorted 25-line `sha256sum <product-path>` manifest used by independent verification is `sha256:dd8e241a1f3a982dce87ca443057cb78de86967db811c03e1b6184b9232f5ba9`.
- Harness disposition: the initial sandboxed MCP safety net was environmentally invalid (6 failed, 14 passed plus one subprocess error); the exact host-boundary command passed 20/20 before edits. The global formatter finding is confined to the historical failed verify report, which remediation was forbidden to modify.
- Cleanup: no repository scratch files or Git delivery mutations were created. Unrelated untracked files retain hashes `dc229499ba545927e89ff9caa8e4b9a624b1b2cf34b747a98c3a3b780e7d01b1` and `df75a6c68d047ef417c74e13db3ac725a1325af21d2ff1067ffcdaf6d1755e9b`.
