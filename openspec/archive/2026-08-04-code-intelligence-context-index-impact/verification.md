# Verification

Verified on 2026-08-06 against Node.js v24.16.0 and Yarn 4.15.0.

## Requirement traceability

| Requirements                                | Evidence                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AST-CI-001` through `AST-CI-003`           | Compiler/project and exact filesystem paths remain the authority in `test/context-builder.test.ts`, `test/file-snapshot.test.ts`, `test/relationships.test.ts`, `test/impact.test.ts` and the mutation suite. `test/read-contracts.test.ts` and `test/explore.test.ts` verify bounded metadata and explicit truncation.     |
| `AST-FILE-001` through `AST-FILE-004`       | Exact lines, one-based ranges, total lines, SHA-256 hashes, symbols-only mode, UTF-8/path/symlink/ambiguity failures and read-only behavior in `test/file-snapshot.test.ts`, `test/mcp.integration.test.ts` and the full operation regression suite.                                                                        |
| `AST-FRESH-001` through `AST-FRESH-003`     | State/cause contracts in `test/read-contracts.test.ts` and `test/project-status.test.ts`; fingerprint races and fallback in `test/project.test.ts`, `test/project-fallback.test.ts` and `test/project-watcher.test.ts`. Freshness is exposed in `test/mcp.integration.test.ts`.                                             |
| `AST-STATUS-001`, `AST-STATUS-002`          | Bounded redacted status projection and separated compiler/index/watcher/queue states in `test/project-status.test.ts`, `test/project.test.ts` and `test/mcp.integration.test.ts`.                                                                                                                                           |
| `AST-EXPLORE-001` through `AST-EXPLORE-005` | Read-only routing, reusable selectors, selectors/summary/context/full detail, completeness/unresolved metadata and byte truncation in `test/explore.test.ts`, `test/context-builder.test.ts`, `test/mcp.integration.test.ts` and `test/batch.test.ts`.                                                                      |
| `AST-INDEX-001` through `AST-INDEX-005`     | Fingerprint-driven incremental index, compiler selector validation and compiler fallback in `test/symbol-index.test.ts`, `test/context-builder.test.ts`, `test/project.test.ts` and the agent workflow benchmark corpus.                                                                                                    |
| `AST-INDEX-006`                             | `docs/adr/0005-index-storage-backend.md` and `yarn benchmark:index-storage` evidence defer persistent storage; the package smoke keeps lifecycle scripts disabled and the production index memory-only.                                                                                                                     |
| `AST-REL-001` through `AST-REL-003`         | Normalized edge fields, compiler authority conjunction, exact references/imports/exports/heritage and negative same-name/dynamic-dispatch controls in `test/relationships.test.ts`, `test/test-candidates.test.ts` and `benchmark/impact-corpus.json`.                                                                      |
| `AST-IMPACT-001` through `AST-IMPACT-003`   | Exact root resolution, direction/kind filters, deterministic bounded traversal, direct/transitive metadata and depth/node/edge truncation in `test/impact.test.ts` and `test/mcp.integration.test.ts`.                                                                                                                      |
| `AST-TESTS-001`                             | Pure direct/transitive candidate resolution with reasons, confidence, relationship IDs, naming conventions and stale/truncated/heuristic fail-closed controls in `test/test-candidates.test.ts`; no test runner is invoked.                                                                                                 |
| `AST-WATCH-001` through `AST-WATCH-003`     | Session-owned invalidation-only watcher, debounce/bounds, overflow/error degraded state, synchronous fallback and apply isolation in `test/project-watcher.test.ts`, `test/project-fallback.test.ts` and `test/project.test.ts`.                                                                                            |
| `AST-EVAL-001` through `AST-EVAL-004`       | `benchmark/context-corpus.json`, `benchmark/impact-corpus.json`, `yarn benchmark:agent-workflows`, `yarn benchmark:batch`, `yarn benchmark:formats` and `yarn benchmark:shapes`; outputs preserve declared evidence, call bounds, negative controls and local tokenizer methodology.                                        |
| `AST-AGENT-001`, `AST-AGENT-002`            | `src/services/agent-targets.ts`, `test/agent-targets.test.ts`, `test/agent-setup.test.ts`, `test/setup-wizard.test.ts` and isolated package smoke verify registry-backed Claude/Hermes detection, conflict handling, idempotency and no speculative target.                                                                 |
| `AST-MUTATION-001`, `AST-MUTATION-002`      | Existing prepare/preview/apply, hashes, diagnostics, stale workspace, rollback, lock, replay, MCP, CLI and package assertions remain green in `test/operations.test.ts`, `test/operation-plan-file.test.ts`, `test/mcp.integration.test.ts`, `test/batch.test.ts`, `scripts/cli-smoke.mjs` and `scripts/package-smoke.mjs`. |
| `AST-DOC-001`, `AST-DOC-002`                | `README.md`, `CHANGELOG.md`, `skills/structural-code-editing/SKILL.md`, ADRs 0005–0007 and tool descriptions document compiler/index/syntax/heuristic trust, freshness, fallback, budgets, impact incompleteness, candidate tests and the prepare-review-apply boundary.                                                    |

## Commands and observed results

- `node --version`: `v24.16.0`.
- `yarn --version`: `4.15.0`.
- `yarn format:check`: passed; all matched files use Prettier code style.
- `yarn lint`: passed with zero findings.
- `yarn typecheck`: passed.
- `yarn test`: passed, 29 test files and 213 tests.
- `yarn build`: passed.
- `yarn test:mcp`: passed over stdio with `tool_count: 15`, one fixture file and TOON output.
- `yarn test:cli`: passed with read invocations, TOON output, persisted apply, lock contention, replay, skill installation and agent setup.
- `yarn test:package`: passed from an isolated Yarn tarball install with lifecycle scripts disabled, package/handshake version `0.6.0`, global installation, two targets and idempotent setup.
- `yarn audit`: passed with `No audit suggestions`.
- `yarn benchmark:agent-workflows`: passed `evidence_preserved`, `call_bounds_respected`, `impact_corpus_pass`, `impact_no_heuristic_authority`, `impact_negative_controls_pass` and `impact_candidate_fail_closed` with 15 tools.
- `yarn benchmark:batch`: passed; one conceptual model round-trip instead of two and 94.7294358449533% lower serialized context in the observed run. Duration/RSS are local measurements, not performance claims.
- `yarn benchmark:formats`: passed; observed aggregate eligible MCP token reduction was 24.87447278569994% with lossless checks.
- `yarn benchmark:shapes`: passed with `pass: true`, complete tool metadata and 15 tools; local `o200k_base` estimates remain methodology-bound.
- `git diff --check`: passed.
- `git status --short`: clean after restoring generated benchmark timing artifacts; tracked benchmark evidence remains unchanged.

## Release decision

The final local quality, package, MCP, CLI, audit and benchmark gates pass. The change is ready to archive. No push, release or tag was performed.

## Residual risks and deferred scope

- The local run used Node.js v24.16.0; Node.js 20.19+ and Node.js 22 compatibility remain a CI/runtime-matrix responsibility and are not claimed as locally executed here.
- Persistent index storage remains deferred by ADR 0005 until supported-runtime, packaging, restart, migration and corruption evidence exists.
- Impact is compiler-first but not a proof of runtime impact. Dynamic dispatch, callbacks, framework routes and unsupported relationship kinds remain absent, non-authoritative or incomplete.
- Watcher recovery is bounded and fail-closed; it does not provide a global filesystem transaction and does not coordinate hostile writers or unsupported filesystem semantics.
- Benchmark token, character, duration and memory values are local observations. They are not provider billing, cache, latency SLA or code-quality claims.
- Only Claude Code and Hermes are enabled in the target registry; no additional agent was added without an official contract and isolated smoke.
