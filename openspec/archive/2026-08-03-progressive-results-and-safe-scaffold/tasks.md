# Tasks: progressive results and safe class scaffolding

## 1. Lock evidence and contracts

- [x] Review the supplied scaffold draft against current tool, operation and package architecture.
- [x] Check in exploration, proposal, specification and design with stable requirement IDs.
- [x] Add RED tests for package-derived MCP handshake version.
- [x] Add RED ranking/detail tests before production changes.
- [x] Add RED scaffold construction and no-write transaction tests before production changes.

## 2. Version identity

- [x] Replace the hard-coded MCP version in `src/server.ts` with shipped package metadata.
- [x] Assert in-memory server info and packed stdio handshake versions equal package metadata.
- [x] Keep Node 20.19 and Node 22 compatibility.

## 3. Ranked progressive search

- [x] Add a pure deterministic relevance rank/comparator in `src/services/symbols.ts`.
- [x] Preserve existing query, kind and file filters before ranking.
- [x] Add a search-specific pagination input whose default limit is 20 and explicit max remains 500.
- [x] Add strict `selectors | summary | full` projection schemas and default `summary`.
- [x] Preserve v0.4.0 records under `full`.
- [x] Validate then present every detail through existing JSON/TOON formatting.
- [x] Prove selectors chain unchanged into source and references.
- [x] GREEN: run symbol, pagination, result-format and MCP integration tests.

## 4. Progressive references

- [x] Add strict `locations | context` projection schemas and default `locations`.
- [x] Preserve scope/count/affected-file metadata independently of detail.
- [x] Preserve v0.4.0 records under `context`.
- [x] Validate then present both detail shapes through JSON/TOON.
- [x] Cover declaration inclusion, empty results, pagination and multi-file references.
- [x] GREEN: run references, result-format and MCP integration tests.

## 5. Workflow benchmark

- [x] Add a deterministic result-shaping task corpus with declared expected evidence.
- [x] Measure baseline full/100/context and candidate default profiles in JSON and TOON.
- [x] Report named-tokenizer tokens, bytes, characters, required calls and evidence status.
- [x] Fail on evidence loss, extra required calls or less than 35% aggregate candidate TOON reduction.
- [x] Measure complete eleven-tool `tools/list` characters/tokens and report static delta separately.
- [x] Check the result under `benchmark/results/` and document methodology/claim boundaries.

## 6. Scaffold schemas and pure construction

- [x] Define bounded strict scaffold input types and service-domain interfaces.
- [x] Validate TypeScript identifiers, duplicates, access modifiers, extensions and fragment placement.
- [x] Generate deterministic imports, one exported class, constructor/properties and throwing method placeholders with ts-morph structures.
- [x] Verify the generated AST contains exactly the requested top-level/class declarations.
- [x] Produce body-free outline and direct pending method paths.
- [x] RED/GREEN: add focused scaffold service tests, including invalid/adversarial fragments.

## 7. Hash-bound new-file plans

- [x] Add `scaffold_class` operation kind.
- [x] Represent absent preimages distinctly without changing existing modification plan hashes.
- [x] Extend plan collection, hash material, workspace postimage and creation diff generation.
- [x] Add safe absent-target and parent validation.
- [x] Extend operation import/export for absent targets while preserving v0.4.0 modification plans.
- [x] RED/GREEN: cover empty-file distinction, plan tampering, old-plan compatibility and exact preview.

## 8. No-clobber apply and rollback

- [x] Stage created bytes with existing bounds/mode/fsync guarantees.
- [x] Commit creation with atomic no-clobber semantics; never fall back to overwrite-capable rename.
- [x] Detect a target that appears after preparation before any existing-file write.
- [x] Roll back only an exact safe created postimage and fsync its directory.
- [x] Preserve changed/replaced targets and surface rollback failure.
- [x] Recover exact postimage as an idempotent applied receipt.
- [x] RED/GREEN: cover races, symlinks, pre-commit rollback, receipt-failure recovery, persisted replay and existing-operation regressions.

## 9. MCP and batch integration

- [x] Register `ast_scaffold_class` with destructive/idempotent annotations matching prepare-only semantics.
- [x] Return standard prepared coordinates plus target file, outline and pending methods.
- [x] Keep scaffold result JSON-only and exact-preview compatible.
- [x] Add scaffold to final prepare batch tools and plan persistence.
- [x] Update tool-list count/schema, in-memory MCP and stdio smokes.
- [x] GREEN: run MCP, batch, operation-plan and CLI tests.

## 10. Documentation and release readiness

- [x] Add accepted ADRs for progressive result shaping and no-clobber source creation after evidence passes.
- [x] Update README with defaults, compatibility modes, scaffold examples and review/apply flow.
- [x] Update bundled structural-editing skill with progressive reads and scaffold-first implementation.
- [x] Update changelog and package version for v0.5.0.
- [x] Verify packed artifacts include runtime metadata, skill, changelog and executable support.

## 11. Full verification and archive

- [x] Run `yarn format:check`.
- [x] Run `yarn lint`.
- [x] Run `yarn typecheck`.
- [x] Run `yarn test`.
- [x] Run `yarn build`.
- [x] Run `yarn test:mcp`.
- [x] Run `yarn test:cli`.
- [x] Run `yarn test:package`.
- [x] Run `yarn audit`.
- [x] Run format and result-shaping benchmarks and review checked outputs.
- [x] Record requirement-to-test traceability, exact commands, benchmark evidence and residual risks in `verification.md`.
- [x] Archive only after every required task and gate passes.
