# Verification: Safe and Efficient Structural Engine

Status: complete; archive gate satisfied

Date: 2026-08-03

## Final gate evidence

The final gate run was executed after a clean `npm ci`.

| Gate                        | Result                                                  |
| --------------------------- | ------------------------------------------------------- |
| `npm ci`                    | PASS; 236 packages installed, 0 vulnerabilities         |
| `npm run format:check`      | PASS; all files match Prettier                          |
| `npm run lint`              | PASS                                                    |
| `npm run typecheck`         | PASS; production and test tsconfigs                     |
| `npm test`                  | PASS; 7 files, 25 tests                                 |
| `npm run build`             | PASS                                                    |
| `npm run test:mcp`          | PASS; real stdio process, 10 tools, representative call |
| `npm audit --json`          | PASS; 0 vulnerabilities at every severity               |
| `npm pack --dry-run --json` | PASS; v0.2.0, 23 entries, 19,520-byte package           |
| `hermes mcp test ast`       | PASS; connected in 323 ms, 10 tools discovered          |

`.github/workflows/ci.yml` runs install, format check, lint, typecheck, tests, build, stdio smoke, and package dry-run on Node 20.19 and 22. The current directory is not a Git repository, so no hosted GitHub Actions run or git diff exists to cite.

## Regression evidence

| Behavior                    | Assertion                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| External source freshness   | `test/project.test.ts`: refreshes externally changed files                                                     |
| Included/deleted membership | `test/project.test.ts`: discovers and forgets files                                                            |
| Extended config freshness   | `test/project.test.ts`: rebuilds after extended config changes                                                 |
| Exact and ambiguous paths   | `test/project.test.ts`: exact match and candidate-bearing ambiguity failure                                    |
| Outline fidelity            | `test/outline.test.ts`: modifiers, generics, callables, classes, interfaces, namespaces, no bodies/duplication |
| Symbol lookup/body support  | `test/symbols.test.ts`: nested declarations, callable initializers, ambiguity                                  |
| Diagnostic multiset delta   | `test/diagnostics.test.ts`                                                                                     |
| Pagination bounds           | `test/pagination.test.ts`                                                                                      |
| Read/reference contracts    | `test/mcp.integration.test.ts`: outlines, symbol source/search, references, diagnostics                        |
| Default compact outline     | `test/mcp.integration.test.ts`: symbol metadata omitted by default and available on opt-in                     |
| Exact prepare/preview/apply | `test/mcp.integration.test.ts` and `test/operations.test.ts`                                                   |
| Full-workspace conflict     | `test/operations.test.ts`: unrelated source change invalidates plan                                            |
| Reviewed plan binding       | `test/operations.test.ts`: wrong `plan_hash` rejected                                                          |
| No-write target conflict    | `test/operations.test.ts`: stale target rejected before writes                                                 |
| Diagnostic safety           | `test/operations.test.ts`: new TypeScript error blocks by default                                              |
| Mid-apply failure recovery  | `test/operations.test.ts`: injected failure restores replaced originals                                        |
| Concurrency/idempotency     | `test/operations.test.ts`: concurrent retries serialize; one receipt is a replay                               |
| Plan lifecycle              | `test/operations.test.ts`: TTL expiry and bounded-store eviction                                               |
| Byte preservation           | `test/operations.test.ts`: UTF-8 BOM retained                                                                  |
| Real protocol startup       | `scripts/mcp-smoke.mjs`: spawned `dist/index.js`, initialized MCP, discovered and called tools                 |

## Final requirement traceability

| Requirement group | Implementation                                                                                                    | Tests/evidence                           | Result |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------ |
| AST-PROJ-*        | `project.ts`: `withProject`, `synchronizeSession`, bounded keyed sessions; `workspace.ts`: `createConfigSnapshot` | `project.test.ts`                        | PASS   |
| AST-PATH-*        | `project.ts`: `getSourceFileOrThrow`                                                                              | `project.test.ts`                        | PASS   |
| AST-SYM-*         | `symbols.ts`: `collectSymbols`, `findDeclaration`, `executableDeclaration`; `search_symbols.ts`                   | `symbols.test.ts`, MCP integration       | PASS   |
| AST-OUT-*         | `outline.ts`: typed declaration formatters and `buildFileOutline`; opt-in metadata in `get_outline.ts`            | `outline.test.ts`, MCP integration       | PASS   |
| AST-EFF-*         | `result.ts`, `pagination.ts`, deterministic relative-path tool handlers                                           | pagination/project/MCP tests; benchmarks | PASS   |
| AST-REF-*         | `find_references.ts`: compiler references, declaration inclusion, precise bounded context                         | MCP integration cross-file fixture       | PASS   |
| AST-DIAG-*        | `diagnostics.ts`, `get_diagnostics.ts`, prepare-time config/pre-emit deltas and visible override                  | diagnostics/operations/MCP tests         | PASS   |
| AST-OP-*          | `operations.ts`, `workspace.ts`, operation schemas and prepare/preview/apply tools                                | 11 operation tests plus MCP integration  | PASS   |
| AST-QA-*          | Vitest, ESLint, Prettier, dual tsconfig typecheck, stdio smoke, two benchmark CLIs, CI workflow                   | final gates and reports                  | PASS   |
| AST-DOC-*         | `README.md`, `benchmark/README.md`, bundled structural-editing skill v2                                           | `hermes mcp test ast`, package dry-run   | PASS   |

## Benchmark evidence

No model-token savings are claimed. Counts below are serialized characters.

| Workload                       | Full source chars | Compact chars | Reduction | Additional result                           |
| ------------------------------ | ----------------: | ------------: | --------: | ------------------------------------------- |
| This repository, 20 files      |            77,982 |        12,512 |    83.96% | fresh load 543 ms; warm session 1.86 ms     |
| `x-scraper`, 20 files          |           178,110 |        17,036 |    90.44% | fresh load 3,951 ms; warm session 180.16 ms |
| Compact-first corpus, 12 tasks |            83,289 |        28,372 |    65.94% | 12/12 predefined evidence checks passed     |

The project benchmark also records the larger opt-in symbol-metadata payload. Exact reports and per-file measurements are in `benchmark/results/`.

## Implemented safety boundary

- Preparation uses a fresh compiler project and never saves.
- `plan_hash` binds operation kind, diagnostic policy, workspace fingerprint, and exact postimages.
- Workspace fingerprints cover every project source and the root, extended, and referenced TypeScript configs.
- Apply verifies the plan/workspace and target hashes, stages and flushes all outputs, rechecks targets, replaces per file, verifies postimages, and invalidates cached sessions.
- Default diagnostics policy blocks newly introduced TypeScript errors; override is explicit in the prepared output.
- Applied retries are idempotent while the in-memory receipt remains available.

## Remaining risks and deliberate non-guarantees

- Multi-file apply is not a filesystem-wide transaction. Atomicity is per local rename.
- Another process can observe intermediate replacements, and the in-process lock does not coordinate external writers.
- Rollback is best effort and conservatively refuses to overwrite externally changed postimages.
- NFS/network filesystem rename and durability semantics are not guaranteed.
- Plans and applied receipts are bounded in-memory state and disappear on process restart.
- Only UTF-8 source bytes, with or without BOM, are supported.
- Arbitrary signature migrations, source creation/deletion plans, and non-TypeScript languages remain out of scope.
- The checked benchmark sample is deterministic, not statistically representative of every module.
- CI configuration is present but could not be observed remotely because this directory has no `.git` repository.

## Archive decision

All in-scope requirements map to implementation and passing evidence. Unsafe direct writes are unreachable, all final local gates pass, the guarantee boundary is documented, and the change is ready to move from `openspec/changes/` to `openspec/archive/`.
