# Tasks: compiler-first code intelligence for Hermes

Implementation must remain phase-gated. Each task follows RED → GREEN → VERIFY. Do not begin a later phase while its preceding acceptance gates are red.

## 0. SDD and compatibility lock

- [ ] Review this SDD against the current `openspec/archive/` artifacts and ADRs 0001–0004.
- [ ] Add an implementation ADR only after the corresponding design decision has evidence; do not pre-accept persistence or daemon decisions.
- [ ] Capture the v0.5.0 baseline with `git status --short`, `yarn test`, `yarn typecheck`, `yarn build`, `yarn test:mcp`, `yarn test:cli`, `yarn test:package` and the existing benchmark commands.
- [ ] Add RED tests asserting all existing thirteen tools and mutation contracts remain available after additive registrations.

## 1. Shared read contracts and status model

### Task 1.1: Define read metadata types

Status: complete — formal review `deleg_01c075f2` PASS; focused contract tests and full quality gates pass.

Files:

- Create: `src/services/read-contracts.ts`
- Test: `test/read-contracts.test.ts`

Define strict domain types for snapshot state, file ranges, freshness metadata, budget/truncation metadata and source locations. Keep JSON-safe values separate from `ts-morph` objects.

Run: `yarn test test/read-contracts.test.ts`

### Task 1.2: Define project/index status types

Status: complete — formal review `deleg_01c075f2` PASS; focused status tests and full quality gates pass.

Files:

- Create: `src/services/project-status.ts`
- Test: `test/project-status.test.ts`

Define the status state machine and bounded status projection. Test fresh, pending, rebuilding, stale and degraded transitions plus redacted project identity.

Run: `yarn test test/project-status.test.ts`

### Task 1.3: Add freshness metadata to session state

Status: complete — formal review `deleg_80a5ac97` PASS; freshness race, failure recovery and full quality gates pass.

Files:

- Modify: `src/services/project.ts`
- Modify: `src/services/workspace.ts`
- Test: `test/project.test.ts`

Preserve the per-project queue and config digest behavior while tracking source/config snapshot state. Do not change mutation freshness semantics.

Run: `yarn test test/project.test.ts`

### Task 1.4: Expose `ast_get_project_status`

Status: complete — formal review `deleg_80a5ac97` PASS; read-only tool/schema integration and full quality gates pass.

Files:

- Create: `src/tools/get_project_status.ts`
- Modify: `src/server.ts`
- Test: `test/mcp.integration.test.ts`

Register a read-only bounded status tool. Verify it exposes state and counts without credentials or unnecessary absolute paths.

Run: `yarn test test/mcp.integration.test.ts -t "project status"`

### Phase 1 gate

Status: complete — formal review `deleg_80a5ac97` PASS; 152/152 tests, typecheck, lint, build, format check, MCP/CLI/package smokes, benchmark and diff check pass.

Run:

```bash
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn build
yarn test:mcp
yarn test:cli
yarn test:package
```

Expected: all existing tests plus the new status/contract tests pass; no mutation behavior changes.

## 2. Exact bounded file reads

### Task 2.1: Add file snapshot provider

Status: complete — provider tests pass; project path resolution is reused from `src/services/project.ts`, so no modification to that file was required.

Files:

- Create: `src/services/file-snapshot.ts`
- Modify: `src/services/project.ts`
- Test: `test/file-snapshot.test.ts`

Implement project-scoped path resolution, symlink/containment checks, exact UTF-8 reads, line ranges, SHA-256 hashes and bounded limits. Reuse existing path conventions; do not create a generic unrestricted filesystem API.

Run: `yarn test test/file-snapshot.test.ts`

### Task 2.2: Add `ast_get_file` schema and tool

Status: complete — MCP integration, stdio smoke and package smoke pass with the additive fourteenth tool.

Files:

- Create: `src/tools/get_file.ts`
- Modify: `src/server.ts`
- Test: `test/mcp.integration.test.ts`

Implement default line mode and explicit `symbols_only` mode. Verify project-relative output, line numbering, total lines, file hash and stale/error states.

Run: `yarn test test/mcp.integration.test.ts -t "get file"`

### Task 2.3: Add file-read documentation and skill guidance

Status: complete — README, bundled skill and changelog document source mode, `symbols_only`, read-only behavior and freshness semantics.

Files:

- Modify: `README.md`
- Modify: `skills/structural-code-editing/SKILL.md`
- Modify: `CHANGELOG.md`

Document when to use `ast_get_file` versus `ast_get_outline`/`ast_get_symbol_source`, and state that it is read-only.

Run: `yarn format:check`

### Phase 2 gate

Status: complete — 157/157 tests, typecheck, build, lint, format check, MCP/CLI/package smokes and diff check pass; invalid, ambiguous, traversal and escaping-symlink paths fail closed.

Run the full Phase 1 gate plus focused file path/range, MCP stdio and package smoke tests. Verify that invalid paths fail before reading and that no existing mutation test changes.

## 3. Composed exploration

### Task 3.1: Extract a reusable context builder

Status: complete — shared compiler-backed symbol ranking and reference collection pass focused builder tests without a second resolver.

Files:

- Create: `src/services/context-builder.ts`
- Modify: `src/services/symbols.ts`
- Test: `test/context-builder.test.ts`

Compose existing search, outline, source and reference services. Preserve current rank/detail semantics and exact downstream selectors. Do not add natural-language interpretation or a second resolver.

Run: `yarn test test/context-builder.test.ts`

### Task 3.2: Add `ast_explore` input/output schemas

Status: complete — strict route/detail/budget schemas and byte-limit truncation pass focused tool tests.

Files:

- Create: `src/tools/explore.ts`
- Create: `test/explore.test.ts`

Implement strict query, selector/file routing, detail, filters, limits and output budgets. Include completeness, freshness, truncation and unresolved-item metadata.

Run: `yarn test test/explore.test.ts`

### Task 3.3: Register and integrate exploration

Status: complete — MCP integration proves query and exact-symbol routes preserve reusable selectors and source/reference evidence in one call.

Files:

- Modify: `src/server.ts`
- Modify: `src/batch/schema.ts` only if the composed read is intentionally allowed in batch
- Modify: `test/mcp.integration.test.ts`
- Modify: `test/batch.test.ts` only for explicit compatibility coverage

Prove one exploration call can replace the checked search-to-source model workflow without losing the exact selector or required source evidence. Keep low-level tools available.

Run: `yarn test test/mcp.integration.test.ts -t "explore"`

### Task 3.4: Add context workflow benchmark

Status: complete — deterministic corpus passes evidence and call-bound gates; report records calls, bytes, named-tokenizer estimates, metadata and timings separately.

Files:

- Create: `benchmark/context-corpus.json`
- Create: `scripts/benchmark-agent-workflows.mjs`
- Modify: `benchmark/README.md`
- Modify: `package.json`

Compare generic full-file, existing primitive/batch and `ast_explore` workflows. Report evidence, calls, invocations, bytes, named-tokenizer estimates, static tool metadata and local timings separately.

Run: `yarn benchmark:agent-workflows`

Expected: the benchmark fails on missing evidence or excess calls; it does not assert a universal token or billing claim.

### Phase 3 gate

Status: complete — context corpus, focused exploration tests, typecheck, lint, format, MCP smoke and the full quality/package gates pass.

The context corpus passes with required evidence preserved. Existing `yarn benchmark:batch`, `yarn benchmark:shapes` and all package/MCP gates remain green.

## 4. Incremental in-memory index

### Task 4.1: Define index entry and store interfaces

Status: complete — versioned project/file fingerprints, body-free symbol metadata, runtime boundary validation and async store contract pass focused tests, typecheck and lint.

Files:

- Create: `src/services/symbol-index.ts`
- Test: `test/symbol-index.test.ts`

Define versioned file/symbol entries, project identity, fingerprint metadata and a store interface. Keep source bodies out of entries by default.

Run: `yarn test test/symbol-index.test.ts`

### Task 4.2: Implement file fingerprint invalidation

Status: complete — metadata-aware fingerprints with forced hash verification, deterministic add/change/delete classification, atomic-save and timestamp-collision coverage, config/reference digest coverage, and project/workspace snapshot integration pass the full regression and smoke gates.

Files:

- Create: `src/services/file-fingerprints.ts`
- Modify: `src/services/project.ts`
- Modify: `src/services/workspace.ts`
- Test: `test/file-fingerprints.test.ts`

Handle unchanged files, additions, deletions, atomic editor saves, timestamp collisions, config changes and project-reference changes. Fingerprint correctness must not depend solely on watcher events.

Run: `yarn test test/file-fingerprints.test.ts`

### Task 4.3: Implement in-memory symbol index

Status: complete — compiler-backed symbol projection, body-free ranges/signatures, ranked bounded queries, affected-file rebuild reuse, and deleted-entry removal pass the full regression and smoke gates.

Files:

- Modify: `src/services/symbol-index.ts`
- Modify: `src/services/symbols.ts`
- Test: `test/symbol-index.test.ts`

Reuse existing symbol extraction/ranking fields. Rebuild only affected files and remove deleted entries. Keep compiler re-resolution as the final selector check.

Run: `yarn test test/symbol-index.test.ts`

### Task 4.4: Route search and explore through the index

Status: complete — session refresh integration, indexed search/explore query routing, exact compiler selector validation, and compiler fallback for unavailable or mismatched index entries pass the full regression and MCP/CLI/package smoke gates.

Files:

- Modify: `src/tools/search_symbols.ts`
- Modify: `src/services/context-builder.ts`
- Modify: `test/mcp.integration.test.ts`
- Modify: `test/context-builder.test.ts`

Use indexed candidates for ranking, then verify exact selectors in the active compiler project. Add tests for an index/compiler mismatch and stale index fallback.

Run: `yarn test test/mcp.integration.test.ts -t "indexed search"`

### Task 4.5: Add warm/cold index benchmark

Status: complete — reproducible lifecycle report covers initial build, warm indexed query, changed-file rebuild, configuration rebuild, and compiler fallback; local measurements are documented without an absolute latency gate.

Files:

- Modify: `scripts/benchmark-agent-workflows.mjs`
- Modify: `benchmark/README.md`

Report initial build, warm hit, changed-file rebuild, config rebuild and compiler fallback independently. Do not set an absolute latency gate until measurements exist on representative repositories.

Run: `yarn benchmark:agent-workflows`

### Phase 4 gate

The warm path must demonstrate that unchanged files are reusable. Index corruption/mismatch tests must fall back to compiler reads. Full mutation and package gates remain green.

## 5. Relationships, impact and candidate tests

### Task 5.1: Define normalized relationship types

Status: complete — normalized endpoints, edge kinds, provenance, confidence, resolution, freshness and derived compiler authority are validated; syntax/heuristic/stale evidence cannot serialize as compiler-authoritative.

Files:

- Create: `src/services/relationships.ts`
- Test: `test/relationships.test.ts`

Implement edge kinds, provenance, confidence, resolution state and freshness. Test that syntax/heuristic edges cannot be serialized as compiler-authoritative.

Run: `yarn test test/relationships.test.ts`

### Task 5.2: Add compiler-backed relationships

Status: complete — compiler-resolved references/usages, module imports/exports, class/interface heritage and implemented types are collected into normalized edges; unresolved modules are omitted rather than promoted to exact evidence, and failed session synchronization invalidates retained relationship edges.

Files:

- Modify: `src/services/relationships.ts`
- Modify: `src/services/project.ts`
- Modify: `src/services/symbols.ts`
- Test: `test/relationships.test.ts`

Start with exact references/usages, imports/exports where resolved, inheritance and implemented types. Preserve existing `ast_find_references` semantics instead of duplicating a weaker implementation.

Run: `yarn test test/relationships.test.ts`

### Task 5.3: Implement bounded impact traversal

Status: complete — exact compiler root resolution, deterministic incoming/outgoing/both traversal, relationship-kind filters, depth/node/edge budgets, consistent node-edge output and explicit truncation/incomplete metadata are covered by focused tests and full gates.

Files:

- Create: `src/services/impact.ts`
- Test: `test/impact.test.ts`

Implement exact root resolution, deterministic bounded traversal, direction filters, edge-kind filters, node/edge/depth limits and incomplete/truncated metadata.

Run: `yarn test test/impact.test.ts`

### Task 5.4: Add `ast_get_impact`

Status: complete — read-only MCP adapter over the synchronized compiler-backed relationship graph, exact root resolution, direct/transitive evidence, explicit freshness and bounded truncation metadata, JSON/TOON presentation, and mutation-field exclusion are covered by MCP integration, stdio, agent-setup and benchmark-manifest verification.

Files:

- Create: `src/tools/get_impact.ts`
- Modify: `src/server.ts`
- Test: `test/mcp.integration.test.ts`
- Modify: `scripts/mcp-smoke.mjs`
- Modify: `scripts/fixtures/fake-agent.mjs`
- Modify: `test/agent-setup.test.ts`
- Modify: `scripts/benchmark-result-shapes.mjs`
- Modify: `benchmark/results/self-result-shapes.json`
- Modify: `benchmark/results/self-formats.json`
- Modify: `benchmark/README.md`
- Modify: `README.md`
- Modify: `skills/structural-code-editing/SKILL.md`

Expose the read-only impact contract. Ensure it returns direct versus transitive evidence and never returns mutation coordinates as if they were a prepared plan.

Run: `yarn test test/mcp.integration.test.ts -t "impact"`

### Task 5.5: Add candidate test resolver

Status: complete — pure candidate resolver over complete fresh compiler-backed impact evidence, configurable test file globs/directories, deterministic direct/transitive reasons, confidence and bounded path evidence; it never executes tests.

Files:

- Create: `src/services/test-candidates.ts`
- Modify: `src/services/impact.ts`
- Test: `test/test-candidates.test.ts`

Use configured test naming/directory conventions and exact impact evidence. Return file, reason, confidence and evidence. Do not run tests.

Run: `yarn test test/test-candidates.test.ts`

### Task 5.6: Add relationship/impact corpus

Status: complete — five-scenario deterministic corpus covers exact references, same-name false matches, unsupported string-keyed dynamic dispatch, stale freshness and depth truncation; the workflow report fails closed on heuristic authority and stale/incomplete candidate evidence.

Files:

- Create: `benchmark/impact-corpus.json`
- Modify: `scripts/benchmark-agent-workflows.mjs`
- Modify: `benchmark/README.md`
- Modify: `benchmark/results/self-agent-workflows.json`

Add negative controls for unsupported dynamic dispatch, false same-name matches, stale indexes and truncated traversals. Fail if heuristic evidence is presented as exact.

Run: `yarn benchmark:agent-workflows`

### Phase 5 gate

Status: complete — exact relationships, bounded impact, candidate-test resolution and the relationship/impact corpus pass with compiler authority preserved and negative controls green.

Exact relationships and bounded impact pass the corpus. Heuristic/dynamic edges are either absent or correctly labelled incomplete/low-confidence. Existing reference, diagnostic and mutation tests remain green.

## 6. Watcher and freshness operations

### Task 6.1: Implement session-owned watcher abstraction

Status: complete — the watcher owns per-session `fs.watch` handles, debounces and deduplicates bounded paths, reports backend/startup failures, and closes on session invalidation, eviction and global cleanup. It only emits invalidation callbacks; it never writes code or executes tests.

Files:

- Create: `src/services/project-watcher.ts`
- Modify: `src/services/project.ts`
- Test: `test/project-watcher.test.ts`

Add debounce, pending path tracking, close/eviction behavior and bounded event handling. The watcher only invalidates/schedules; it never writes code or runs tests.

Run: `yarn test test/project-watcher.test.ts`

### Task 6.2: Add degraded synchronous fallback

Status: complete — watcher backend errors and bounded event overflow fail closed; the existing synchronous session synchronization refreshes exact reads from verified filesystem fingerprints while the status machine preserves `watcher_failure` and projects `degraded`.

Files:

- Modify: `src/services/project.ts`
- Modify: `src/services/project-status.ts`
- Test: `test/project.test.ts`
- Test: `test/project-watcher.test.ts`
- Test: `test/project-fallback.test.ts`

Simulate watcher error/overflow and prove exact reads use synchronous fingerprint synchronization while status reports degraded state.

Run: `yarn test test/project.test.ts test/project-watcher.test.ts`

### Task 6.3: Integrate freshness into read responses

Status: complete — `ast_get_file` now exposes bounded project freshness alongside its file-level snapshot state; `ast_explore` and `ast_get_impact` expose the same session metadata, while impact remains fail-closed when exact relationships are not fresh.

Files:

- Modify: `src/tools/get_file.ts`
- Modify: `src/tools/explore.ts`
- Modify: `src/tools/get_impact.ts`
- Modify: `test/mcp.integration.test.ts`

Prove stale, pending, fresh and degraded responses are distinguishable and bounded.

Run: `yarn test test/mcp.integration.test.ts -t "freshness"`

### Phase 6 gate

Status: complete — watcher failure cannot hide changes or weaken mutations; session cleanup closes watchers; freshness is exposed on bounded read responses; full tests, MCP, CLI and package gates pass.

Watcher failure cannot hide changes or weaken mutations. Session eviction closes watchers. Full test, MCP, CLI and package gates pass.

## 7. Optional persistent index backend

### Task 7.1: Evaluate storage backends

Status: complete — the reproducible benchmark measured memory, atomic JSON and native `node:sqlite` adapters, reported portable/WASM SQLite as unavailable, exercised restart/migration/corruption probes and the isolated tarball smoke, and selected no persistent backend until Node 20/22 evidence exists.

Files:

- Create: `docs/adr/0005-index-storage-backend.md` after evidence
- Create: `scripts/benchmark-index-storage.mjs`
- Modify: `package.json` only if a dependency is selected

Compare memory-only, native SQLite, portable/WASM SQLite and file-based storage against Node 20.19+, Node 22, Yarn lifecycle scripts disabled, isolated tarball install, restart, migration and corruption recovery. Do not add a dependency before this gate.

Run: `yarn benchmark:index-storage`

### Task 7.2: Implement selected persistent store

Status: deferred by ADR 0005 — Task 7.1 selected no persistent backend because the required Node 20/22 and portable/WASM evidence is unavailable.

Files:

- Create: `src/services/persistent-index.ts`
- Modify: `src/services/symbol-index.ts`
- Modify: `src/services/runtime-state.ts` only for separate private index namespace if required
- Test: `test/persistent-index.test.ts`

Implement schema versioning, project identity isolation, atomic/transactional updates, rebuild-on-corruption and no source-body persistence by default.

Run: `yarn test test/persistent-index.test.ts`

### Task 7.3: Add restart and package smoke coverage

Status: deferred by ADR 0005 — restart, migration, corruption and isolated-package probes are covered by the evaluation runner; no production persistent adapter exists to wire into runtime smoke.

Files:

- Modify: `scripts/package-smoke.mjs`
- Modify: `scripts/cli-smoke.mjs`
- Test: `test/persistent-index.test.ts`

Verify restart reuse, schema mismatch rebuild, malformed state recovery, two-project isolation and lifecycle-disabled packed installation.

Run: `yarn test:package && yarn test:cli`

### Phase 7 gate

Status: complete — the versioned in-memory interface remains the production default and persistence is disabled by evidence, not by an untested stub.

If the backend cannot pass supported-version/package gates, ship the versioned in-memory interface and disable persistence by default. Never trade package integrity or mutation safety for warm restart speed.

## 8. Agent target registry

### Task 8.1: Extract target contract

Status: complete — `agent-targets.ts` is the registry/strategy seam for target identity, executable discovery metadata, MCP inspection/registration and skill target mapping; setup orchestration retains bounded command IO, conflict handling, force semantics and idempotency.

Files:

- Create: `src/services/agent-targets.ts`
- Modify: `src/services/setup-wizard.ts`
- Modify: `src/services/agent-setup.ts`
- Test: `test/agent-targets.test.ts`
- Test: `test/setup-wizard.test.ts`

Preserve Claude/Hermes detection, conflict handling, `--force-skill`, idempotency and verification while moving target-specific behavior behind a registry.

Run: `yarn test test/agent-targets.test.ts test/setup-wizard.test.ts test/agent-setup.test.ts`

### Task 8.2: Add one new target only if justified

Status: deferred — no additional target has a verified official configuration/MCP contract and isolated smoke in this change.

Files:

- Modify: `src/services/agent-targets.ts`
- Modify: `test/agent-setup.test.ts`
- Modify: `scripts/package-smoke.mjs`
- Modify: `README.md`

Add a further agent only after its official config/MCP contract and isolated smoke are known. If no target has sufficient evidence, keep the registry extensible but do not add a speculative integration.

Run: `yarn test:package`

### Phase 8 gate

Status: complete — Claude/Hermes behavior is preserved behind the registry; no speculative target was added.

Existing Claude/Hermes behavior is unchanged. New targets are opt-in, conflict-safe and covered by package smoke. No secrets are logged or persisted.

## 9. Documentation and release readiness

### Task 9.1: Document trust and freshness model

Status: complete — README, bundled skill and changelog document the public tools, compiler/index/syntax/heuristic trust boundary, fresh versus stale/degraded reads, bounded budgets/truncation, compiler-backed test-candidate rules and the prepare-review-apply mutation boundary.

Files:

- Modify: `README.md`
- Modify: `skills/structural-code-editing/SKILL.md`
- Modify: `CHANGELOG.md`

Document the new tools, exact/index/syntax/heuristic trust labels, stale/degraded behavior, budgets, candidate tests and mutation boundary.

Run: `yarn format:check`

### Task 9.2: Add accepted ADRs from evidence

Status: complete — ADR 0006 records the context/freshness contract and ADR 0007 records compiler-first relationship/impact authority, bounded traversal and conservative candidate-test resolution. ADR 0005 already records the evidence-backed decision to defer persistent index storage.

Files:

- Create: `docs/adr/0006-context-and-freshness-contract.md`
- Create: `docs/adr/0007-compiler-first-impact-relationships.md`
- Create: persistence ADR only if Task 7 selects a persistent backend

Record decisions, alternatives, consequences and measured evidence. Do not turn benchmark estimates into universal claims.

### Task 9.3: Full quality gate

Run:

```bash
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn build
yarn test:mcp
yarn test:cli
yarn test:package
yarn audit
yarn benchmark:agent-workflows
yarn benchmark:batch
yarn benchmark:formats
yarn benchmark:shapes
git diff --check
```

Expected: all gates pass; status/index/impact benchmarks retain required evidence; mutation and package safety remain unchanged.

## Archive gate

Before archiving this change:

- every accepted requirement has a test or benchmark evidence row;
- the final verification records exact commands and observed output;
- residual risks and unsupported relationship kinds are documented;
- no unrelated code or dependency changes are included;
- `git status --short` is reviewed;
- the change is archived only after implementation and verification are complete.
