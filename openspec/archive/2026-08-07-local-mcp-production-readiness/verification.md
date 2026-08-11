# Verification: local MCP production readiness

Date: 2026-08-11

## Decision boundary

- This document verifies the local `0.7.0` release candidate before its OpenSpec archive transition.
- The candidate is not published. No push, npm publication, dist-tag change, Git tag, or GitHub Release has occurred.
- Verified support is limited to Linux x64 with the required GNU coreutils `mv` primitive. Other Linux architectures, Linux systems without that primitive, macOS, and Windows remain `unverified`.
- Node `v22.5.0` requires `--experimental-sqlite`; Node `v24.16.0` does not.
- The compiler remains semantic authority. SQLite remains a derived cache behind explicit `canary`; default and reserved `enabled` remain fail-closed to memory-only behavior.
- A canary result is candidate-authorized evidence, not evidence of a public release transition.

## Evidence classes

| Class                                            | Scope                                                                                                    | Authority                                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current preliminary evidence                     | Clean commit `15b19b1a5b4244d1d4a7e76ddcf8a4c0a2612b4c`, tree `7e56b0f7f7e1d04da8313391f2397a45ff8ce623` | Node 22.5/24 release matrix and four fresh raw canaries described below                                                                            |
| Historical checked evidence                      | Commit `fbaee3294afa74b3e611b0a0646ee437cc330fb9`, tree `719b45ee3a73f43277981c0f842db13975f6b427`       | Four immutable checked production-readiness reports; historical support evidence, not a guarantee that replaces current gates                      |
| Exact-tree release-policy evidence               | Commit `98d8d52a3191000dcef99959e698e0b28963e4ff`, tree `0df1b8e920ce6567ff24cdfd53c2824198479ffc`       | Task 6.2 workflow, preflight, registry-consumer, and three external read-only PASS verdicts                                                        |
| Current release-candidate documentation evidence | Commit `bed8e148bfaa98ed057b2a541f1f45a0b7c47e0e`, tree `01999b4605c62e163e53abea5be8f55faa7fee13`       | Task 6.3 package/docs candidate and three exact-tree PASS verdicts                                                                                 |
| Pending external evidence                        | No artifact yet                                                                                          | Push, exact-SHA CI, `next` publication/readback, public consumer proof, `latest`, tag, and hosted release remain blocked on separate authorization |

## Requirement traceability

| Requirement    | Implementation                                                                             | Assertions and artifacts                                                                              | Result                                                                |
| -------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `MCP-PROD-001` | `src/services/runtime-policy.ts`, `src/services/project.ts`                                | `test/runtime-policy.test.ts`, `test/project.test.ts`, both-runtime full matrix                       | PASS                                                                  |
| `MCP-PROD-002` | `src/services/project-operation-scheduler.ts`                                              | `test/project-operation-scheduler.test.ts`, `test/project.test.ts`, queue canary gates                | PASS                                                                  |
| `MCP-PROD-003` | Runtime policy plus bounded scheduler wait state                                           | Scheduler/runtime-policy tests; timeout and queue canary outcomes                                     | PASS                                                                  |
| `MCP-PROD-004` | `src/services/request-context.ts`, scheduler cancellation, MCP adapters                    | `test/request-context.test.ts`, scheduler/project/MCP integration tests, cancellation canary gates    | PASS                                                                  |
| `MCP-PROD-005` | Completion-critical mutation handling in `src/services/operations.ts`                      | `test/operations.test.ts`; mutation apply/replay/rollback canary gates                                | PASS                                                                  |
| `MCP-PROD-006` | Operation deadline policy and request context                                              | Runtime-policy, scheduler, project and MCP integration tests; preregistered canary deadline           | PASS                                                                  |
| `MCP-PROD-101` | Admission shutdown gate in `src/services/shutdown.ts`, `src/server.ts`, `src/index.ts`     | `test/shutdown.test.ts`, lifecycle smoke                                                              | PASS                                                                  |
| `MCP-PROD-102` | Idempotent coordinated drain and resource close                                            | Shutdown/project tests and `scripts/mcp-lifecycle-smoke.mjs`                                          | PASS                                                                  |
| `MCP-PROD-103` | Bounded child-process lifecycle harness                                                    | `scripts/mcp-lifecycle-smoke.mjs`, `yarn test:lifecycle` in both runtimes                             | PASS                                                                  |
| `MCP-PROD-201` | `src/services/public-errors.ts`, result adapters                                           | `test/public-errors.test.ts`, `test/result-format.test.ts`, MCP/public-error smoke                    | PASS                                                                  |
| `MCP-PROD-202` | Canonical bounded redaction and response projection                                        | Public-error/result/MCP integration tests, packed public-error smoke                                  | PASS                                                                  |
| `MCP-PROD-203` | `src/services/runtime-logger.ts`, opaque request correlation                               | Request-context/result/MCP tests; correlated stdio and CLI smoke                                      | PASS                                                                  |
| `MCP-PROD-204` | Stable MCP envelope through all 15 adapters                                                | MCP integration, `scripts/mcp-smoke.mjs`, packed package smoke                                        | PASS                                                                  |
| `MCP-PROD-301` | `src/services/runtime-activity.ts`, bounded project status                                 | `test/project-status.test.ts`; recomputed queue/admission canary gates                                | PASS                                                                  |
| `MCP-PROD-302` | Bounded counters/timings and exact manual-GC measurement                                   | Runtime/status tests; deterministic fixture resource gates                                            | PASS                                                                  |
| `MCP-PROD-401` | Disabled default and fail-closed reserved `enabled` policy                                 | Symbol-index policy/project tests and all fresh canaries                                              | PASS                                                                  |
| `MCP-PROD-402` | Explicit read-only `canary` policy and immutable real-repository workloads                 | Canary harness/workloads/tests; four fresh raw reports                                                | PASS                                                                  |
| `MCP-PROD-403` | Compiler parity, restart, rollback and recovery probes                                     | Four fresh raw reports: 40/40 gates each, 20 iterations, 3 restarts                                   | PASS                                                                  |
| `MCP-PROD-404` | Closed four-member freezer and accepted support policy                                     | `scripts/canary-local-mcp.mjs`, declarations/tests, four immutable checked reports, `docs/support.md` | PASS                                                                  |
| `MCP-PROD-405` | Runtime/workload/harness/Git identity and canonical durable reports                        | Canary tests; checked report hashes and current raw report hashes below                               | PASS                                                                  |
| `MCP-PROD-501` | `README.md`, `SECURITY.md`, `docs/support.md`, ADR 0010                                    | Package/preflight tests; Linux x64 plus GNU `mv` wording checks                                       | PASS                                                                  |
| `MCP-PROD-502` | Compiler/cache, local-process, same-UID and external-authority boundaries                  | ADR 0010, support policy, canary/release preflight tests                                              | PASS                                                                  |
| `MCP-PROD-503` | Vulnerability policy and read-only least-authority automation                              | `SECURITY.md`, pinned workflows, workflow policy checker/tests                                        | PASS                                                                  |
| `MCP-PROD-601` | Reconciled README, changelog, support, ADR, skill and OpenSpec                             | Task 6.3 exact-tree reviews; package/workflow-policy tests; this traceability table                   | PASS                                                                  |
| `MCP-PROD-602` | Package version `0.7.0`, unreleased changelog entry, packaged policy docs and skill        | Package smoke, dry-run pack, release preflight, both-runtime matrix                                   | PASS                                                                  |
| `MCP-PROD-603` | Exact-main-SHA CI authorization and immutable action policy                                | `.github/workflows/release.yml`, workflow-policy checker/tests, release preflight                     | PASS locally; remote exact-SHA CI pending Task 7.1                    |
| `MCP-PROD-604` | Physical tarball `gitHead` binding, provenance/readback and signature contract             | Release-preflight and registry-consumer tests; mock-registry proof                                    | PASS locally; public registry readback pending Tasks 7.2/7.3          |
| `MCP-PROD-605` | Fresh packed consumer oracle for reads and prepare/preview/apply/replay                    | `scripts/registry-consumer-smoke.mjs` and tests                                                       | PASS locally; public `next` consumer proof pending Task 7.3           |
| `MCP-PROD-606` | Physical authority separation and explicit transition gates                                | Release workflow/policy tests; no external transition recorded                                        | PASS for local authorization boundary; transitions remain blocked     |
| `MCP-PROD-607` | Reproducible two-runtime matrix, exact-tree candidate binding, two-review archive protocol | `scripts/release-candidate-matrix.mjs`, its tests, preliminary reports, Tasks 6.4b-6.4e               | Preliminary PASS; final staged-tree gate and Review B pending archive |
| `MCP-PROD-701` | Compiler-authoritative project/context/symbol consumers                                    | Project/context/symbol/index and MCP integration tests; parity canary gates                           | PASS                                                                  |
| `MCP-PROD-702` | Hash-bound prepare/preview/apply/replay protocol                                           | Operations tests, CLI/package/registry-consumer smoke, mutation canary gates                          | PASS                                                                  |
| `MCP-PROD-703` | Disabled default, explicit `canary`, derived SQLite fallback/recovery                      | ADR 0009, policy/store/project tests, four fresh raw canaries                                         | PASS                                                                  |

## Preliminary release matrix

The clean-tree command was:

```text
AST_NODE_22_BIN=<absolute-node-22.5-binary> \
AST_NODE_24_BIN=<absolute-node-24-binary> \
yarn test:release-candidate \
  --output-dir /tmp/ast-mcp-release-candidate/preliminary
```

The summary returned `status: pass`, package version `0.7.0`, no candidate-tree claim, and identical initial/final index tree `7e56b0f7f7e1d04da8313391f2397a45ff8ce623`.

| Runtime   | Identity   | Node options            | Ordered commands | Result | Report SHA-256                                                     |
| --------- | ---------- | ----------------------- | ---------------: | ------ | ------------------------------------------------------------------ |
| Node 22.5 | `v22.5.0`  | `--experimental-sqlite` |               15 | PASS   | `89f54f3ce94196e8cb5d6448324b35bb45ab0cc1d56f088def6453cace7dc683` |
| Node 24   | `v24.16.0` | none                    |               15 | PASS   | `78de945e22afd22a8ee0d7db00601f9e927aa917472a2e8f858fc63ce1ed9ad5` |

Summary SHA-256: `3fd7150750ba8e8c43d11ba7aab21e6341e496e1a184f9ce93ac896dedd1a747`.

Each runtime ran, in order: immutable install, format check, lint, typecheck, full tests, build, MCP smoke, public-error smoke, lifecycle smoke, CLI smoke, package smoke, audit, pack dry-run, workflow policy, and `git diff --check`. Every command exited zero without timeout.

## Preliminary current-tree canaries

The four raw reports bind package commit `15b19b1a5b4244d1d4a7e76ddcf8a4c0a2612b4c`, package HEAD/worktree tree `7e56b0f7f7e1d04da8313391f2397a45ff8ce623`, clean package/project status, the selected runtime, workload bytes and harness bytes. No report claims a staged candidate tree at this preliminary phase.

| Project          | Runtime    | Gates | Iterations/restarts | Result | Raw report SHA-256                                                 |
| ---------------- | ---------- | ----: | ------------------- | ------ | ------------------------------------------------------------------ |
| `ast-mcp-server` | `v24.16.0` | 40/40 | 20 / 3              | PASS   | `afd210e6d95f23b3e6925f91a88d4f77d91d9e8324768a8f8b3766e181aa0bef` |
| `ast-mcp-server` | `v22.5.0`  | 40/40 | 20 / 3              | PASS   | `3c14d88e241d1c5edcb99461f79442eb2d22a6abdf0e48ec07d3d03b490f2ff6` |
| `x-scraper`      | `v24.16.0` | 40/40 | 20 / 3              | PASS   | `0f2c0b96a2cbb8099feaa4aeda824dbf7f2c74c77aac9ae49a784a3b91e853d1` |
| `x-scraper`      | `v22.5.0`  | 40/40 | 20 / 3              | PASS   | `49fbeba06351ee88ca4414b75f4f35a1a4324b84951fb48fc5c5893e417209ff` |

Both `x-scraper` reports bind clean commit `a86fffb15ad21912a87583c2d498f813c47aa27e` and worktree tree `9c359690b58867e01750905b76b1c0cca3ad15a2`.

The raw reports remain outside the repository and were not passed to `freeze-report-set`; the checked historical report set was not replaced.

## Immutable checked report hashes

| Checked report                                                        | SHA-256                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `benchmark/results/production-readiness/ast-mcp-server-node22.5.json` | `16c545d6b9916aee20be6c7865b85a54b999ae79067c0ff34a7968b69333fecf` |
| `benchmark/results/production-readiness/ast-mcp-server-node24.json`   | `a091698c22a02dbafe027788d6d0ad118c04af7e60fdc69db6bb6a68704752a9` |
| `benchmark/results/production-readiness/x-scraper-node22.5.json`      | `5f600a147601f0d5b8b92245209184289f16fa555697026a1fc1bfad87233039` |
| `benchmark/results/production-readiness/x-scraper-node24.json`        | `1b35639df50f1f185519cb65545e7609f5b253f34edd6a7a2bba995482cacf42` |

These bytes remain identical to the accepted historical report tree. They are retained as dated evidence and are not rewritten to impersonate current-tree evidence.

## Path and sensitive-term scan

The required scoped scan produced 140 matches and SHA-256 `6c363899d5d3ba6c83620a604c681dcaabb03080caa8bfc6d6134a9c7e628878`.

Classification:

- 139 matches are policy words, negative-test vocabulary, tokenizer measurement field names, or the scan expressions themselves. They contain no credential or connection-string value.
- One match is the historical absolute `project_root` in `benchmark/results/self-batch.json`. It contains no credential, is not part of the npm package manifest, predates this production-readiness change, and is retained as historical benchmark provenance rather than rewritten. Current production-readiness reports and public/package outputs use aliases or redacted paths.
- No MongoDB/Redis URI, bearer value, API-key value, password value, secret value, or authentication token was found.

## Implementation and SDD freeze inputs

The implementation range begins at parent `a731381da41553cf4198ea90c61c93f6a095f93b` and ends at clean pre-verification commit `15b19b1a5b4244d1d4a7e76ddcf8a4c0a2612b4c`.

The reproducible complete path manifest is:

```text
git diff --name-status --no-renames \
  a731381da41553cf4198ea90c61c93f6a095f93b \
  15b19b1a5b4244d1d4a7e76ddcf8a4c0a2612b4c
```

It contains 120 path entries and has SHA-256 `34eeb44f4e60009c13d519c067c18302f9bd707cd17614397f4f8077ec109662` when written with Git's exact output bytes. Git object IDs make the complete manifest reproducible without trusting a prose path summary.

Review A must authenticate the exact synthetic pre-archive tree containing the five committed active SDD files plus this uncommitted `verification.md`, freeze all six artifact hashes, and compare implementation paths against the manifest above. Review B must instead authenticate the exact staged post-archive tree and archive-only delta.

## Evidence invalidation record

- The first matrix attempt found a stale canary-test fixture tied to package version `0.6.0`; it failed and is not counted. Commit `e1a967298a7cd1cf681557f417cecdf7904017c2` binds the fixture to current package metadata and passes on both runtimes.
- Evidence generated before commit `15b19b1a5b4244d1d4a7e76ddcf8a4c0a2612b4c` is not used as preliminary closure evidence. That commit reconciles Task 6.4 raw output paths with the frozen harness requirement that raw reports be direct physical children of `/tmp`.
- The rejected nested-output canary invocation failed before writing a raw report. The four reports listed above were generated only after the SDD correction and a fresh clean-tree matrix PASS.

## Residual risks and pending gates

- Node 22.5 SQLite remains experimental and requires the explicit runtime option.
- Timings and RSS from local canaries are observational, not SLAs or capacity guarantees.
- Freezer coordination protects cooperating same-UID processes; it is not a boundary against a malicious writer with the same UID.
- Derived-cache loss or quarantine can impose rebuild cost but must not weaken compiler authority or mutation checks.
- Review A, archive staging, final candidate-bound matrix/canaries, Review B, and archive commit remain pending at this document's authoring boundary.
- Every public transition in Tasks 7.1-7.4 remains separately blocked and requires its prescribed external evidence and authorization.
