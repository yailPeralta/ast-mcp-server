# AST MCP Server Roadmap

> **Recommendation:** treat v0.13.1 as the released baseline and continue issue-first with R-01, then F-01. M-01 and M-02 are closed on `main`; H-01a, H-02, H-03, and H-05 are closed and released. Apply stays denied; UI specialization, Code Mode, and output-vocabulary projection remain separate decisions.

This roadmap owns product status, sequencing, gates, and non-goals. The detailed findings, static evidence, and exact-host continuation contract live in the [v0.13 Harness hardening evidence annex](ast-mcp-server-harness-improvement-report.md).

## North star

Make `ast-mcp-server` the trustworthy structural intelligence layer for coding agents:

- live compilers or language analyzers authorize exact structural evidence and mutations;
- syntax indexes, semantic indexes, embeddings, and heuristics discover candidates only;
- every public result states provenance, freshness, bounds, and completeness honestly;
- mutations remain reviewable, hash-bound, conflict-aware, and recoverable;
- host integrations prove what the model and durable session receive, not only what a direct protocol call returns.

The goal is not to become a generic search daemon, command runner, or host-specific fork. The goal is a small predictable structural interface with evidence that survives each supported runtime boundary.

## Released baseline: v0.13.1

Release evidence binds npm `gitHead`, tag, and GitHub Release for `v0.13.1` to `27b80a3da169b473a3b5c5dfea69ed52903ed4c7`. Registry integrity is `sha512-jqgGoYs8fe7J+E25lZusLK4wV6sjM5n5qiWnfe1RJIxOFo1r5nbtcBr1a/fdSWTYf/37bUNkshQp86UrdBHOsA==`; `latest` and `next` both resolve to `0.13.1`. The immutable v0.13.0 release evidence remains historical baseline evidence rather than being rewritten.

| Foundation                            | Released state                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Evidence contracts                    | Bounded, fresh, provenance-bearing results distinguish complete negatives from incomplete evidence.                            |
| Mutation workflow                     | Prepare, preview, hash-bound apply, diagnostics, conflict checks, rollback, receipts, and replay protections are present.      |
| Derived persistence                   | Native SQLite remains replaceable and non-authoritative; compiler reads are the fallback.                                      |
| Test impact and exploration           | Affected-test candidates and `ast_explore` expose bounded compiler-derived evidence with omission metadata.                    |
| Agent setup and operations            | Managed skill setup, upgrades, doctor diagnostics, and CLI project discovery are shipped.                                      |
| Runtime isolation                     | Opt-in supervised compiler workers use a bounded generation-aware relay; `in_process` remains the rollback.                    |
| Diagnostic summaries and capabilities | Exact bounded aggregates and one immutable tool catalog shipped in v0.12.0.                                                    |
| DeepSeek Harness surface              | The published package exposes reads, prepare, and preview through the pinned bridge; apply remains absent and rejected.        |
| Harness hardening and lifecycle       | Model/durable/replay visibility, schema fidelity, timeout ownership, and native/rendered `15 → 0 → 15` lifecycle are released. |

Released describes immutable product history, not proof that every intended invariant is satisfied. The v0.13 audit identifies static risks and exact-boundary gaps that now require RED evidence and bounded correction.

## Decision and status ledger

| Status                   | Direction                                                                                                                                                                                                                                                                                                                                            | Decision posture                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Shipped**              | v0.13.1 baseline; H-01a/H-02/H-03/H-05 closed and released                                                                                                                                                                                                                                                                                           | Preserve immutable v0.13.0 history and the final v0.13.1 evidence.                        |
| **Closed on main**       | M-01 external-writer-safe apply publication ([#127](https://github.com/yailPeralta/ast-mcp-server/issues/127), [#128](https://github.com/yailPeralta/ast-mcp-server/pull/128)); M-02 edit-aware diagnostic deltas ([#144](https://github.com/yailPeralta/ast-mcp-server/issues/144), [#145](https://github.com/yailPeralta/ast-mcp-server/pull/145)) | Preserve their canonical specs, archives, verified threat boundaries, and Harness denial. |
| **Next**                 | Core authority backlog: R-01, F-01                                                                                                                                                                                                                                                                                                                   | Work issue-first with a deterministic RED at the claimed boundary.                        |
| **Parallel**             | Supervised rollout measurement                                                                                                                                                                                                                                                                                                                       | Measure independently; do not promote supervised mode by default without evidence.        |
| **Then**                 | Optional MCP synchronization progress                                                                                                                                                                                                                                                                                                                | Begin only after hardening gates are green; progress remains observational.               |
| **Later**                | Bounded syntax-pattern discovery; multi-language capability/evidence architecture                                                                                                                                                                                                                                                                    | Prototype read-only discovery first and negotiate capabilities explicitly.                |
| **Benchmark-gated**      | Index direction, `ast_explore` compute budgeting, semantic routing, further isolation                                                                                                                                                                                                                                                                | Implement only when preregistered evidence clears a threshold. “No change” is valid.      |
| **Rejected / non-goals** | Generic executor, heuristic authority, shared daemon/pool by default, generic throwing backend                                                                                                                                                                                                                                                       | Reopen only with a new problem statement and contradictory evidence.                      |

Statuses express sequencing, not implementation authorization.

## Post-v0.13.1 authority work and released Harness evidence

### 1. Recover core authority

**Scope:** M-01, M-02, R-01, F-01.

- **M-01 closed on `main`:** apply publication now fails closed against deterministic external writers and overlapping configurations; the canonical contract and full evidence are archived under `openspec/changes/archive/2026-09-01-2026-09-01-m01-external-writer-safe-apply/`.
- **M-02 closed on `main`:** prepared-operation diagnostic deltas now map unchanged compiler UTF-16 spans across bounded edits, fail closed at touched or uncertain spans, reject legacy prepared v1 plans, and preserve exact-postimage applied recovery; the canonical contract and full evidence are archived under `openspec/changes/archive/2026-09-02-2026-09-01-m02-edit-aware-diagnostic-delta/`. DeepSeek Harness still exposes 15 guarded tools with apply absent and direct invocation denied.
- **R-01 next:** ensure every public relationship kind has real bounded coverage or returns explicit incomplete/unsupported evidence.
- **F-01:** make JSON and TOON success shapes executable at the MCP boundary.

**Entry:** each finding has a minimal deterministic RED at the boundary of the claim.

**Exit:** mutation conflicts, diagnostic additions, relationship negatives, and multi-format output are mechanically defensible in both runtime modes where applicable.

**Stop:** do not combine these into a broad refactor, and do not accept a unit-only reproduction when the defect is at filesystem or MCP publication.

### 2. Preserve released Harness interoperability

**Scope:** H-01a, H-02, H-03, H-05 — closed in v0.13.1.

H-01a and H-02 preserve model-visible native results, durable replay, schema fidelity, all three cross-field failures, and honest multi-format exceptions. H-03 preserves AST-owned timeout and cancellation authority under the shipped queue `30000`, execution `120000`, margin `15000`, and outer `180000` millisecond tuple.

H-05 merged in order through PRs [#118](https://github.com/yailPeralta/ast-mcp-server/pull/118) (`6256391`), [#120](https://github.com/yailPeralta/ast-mcp-server/pull/120) (`ee80d5d`), [#122](https://github.com/yailPeralta/ast-mcp-server/pull/122) (`4d879ae`), and [#124](https://github.com/yailPeralta/ast-mcp-server/pull/124) (`3dab418`); release closure merged in [#125](https://github.com/yailPeralta/ast-mcp-server/pull/125) at `27b80a3`. Its archived OpenSpec lives at `openspec/changes/archive/2026-09-01-2026-08-30-h05-harness-lifecycle/`: the canonical spec contains 6 requirements and 12 scenarios, strict verification passed, and Judgment was APPROVED.

The exact pinned-host gates prove the native and rendered catalog sequence `15 → 0 → 15`, cancellation join, retirement and shutdown, and secret-safe ordered cleanup that continues every owner check after an earlier cleanup failure. They add no public fixture or Harness-host edit. Apply remains absent and rejected.

**Released gate:** exact public package and source-built pinned host; native/model/durable/replay evidence; reconnect/removal; cancellation and public-error fidelity; rendered GUI lifecycle; zero residual owned state.

**Boundary:** direct MCP, configuration, or registry-only success never substitutes for the agent/session boundary. UI specialization, Code Mode, output-vocabulary projection [#103](https://github.com/yailPeralta/ast-mcp-server/issues/103), and apply authorization remain separate.

### 3. Establish compiler and workspace trust boundaries

**Scope:** C-01, S-01, C-02, T-01.

- Differentially test the compiler embedded through `ts-morph` against the declared project compiler corpus.
- Add a canonical allowed-workspace boundary for config, sources, references, previews, and operations.
- Include semantic package boundaries in freshness and prepared-operation identity.
- Build directed, cancellable affected-test proof paths from authoritative predecessors.

**Entry:** exact fixtures reproduce each risk without relying on one developer checkout.

**Exit:** compiler parity limits are explicit; symlinks and external configs cannot escape the authorized workspace; package changes invalidate freshness/plans; proof paths preserve direction and depth.

**Stop:** do not claim sandboxing from `cwd`, and do not present unsupported compiler parity as exact authority.

### 4. Decide mutation continuation in Harness

**Scope:** H-04.

Choose one explicit contract:

1. **read-only:** hide prepare tools;
2. **review-only:** retain prepare/preview as proposals with no apply claim;
3. **approved apply:** add host-native approval bound to workspace, session, `operation_id`, and `plan_hash`, with expiry and reconnect/restart/HMR rejection rules.

**Entry:** core authority and workspace-boundary gates are green, and the host exposes an approval primitive suitable for immutable binding.

**Exit for apply:** guard enablement requires explicit same-session approval, unchanged workspace/plan, cross-workspace rejection, and lifecycle expiry evidence.

**Stop:** an environment variable, annotation, known identifier, or UI control alone is not approval authority.

### 5. Reduce measured complexity

**Scope:** B-01, P-01, A-01, O-01.

- Stop/drain batch fan-out and release batch-owned state.
- Decide the SQLite direction using cold/warm latency, RSS, visited-symbol, and fallback measurements.
- Consolidate endpoint identity and traversal only behind parity gates.
- Add shared payload budgets, typed operational errors, and current release/install documentation.

**Entry:** correctness work is separated from performance/refactoring, with preregistered measurements where claimed.

**Exit:** each slice reduces caller knowledge or measured cost without changing authority, completeness, ordering, or safety.

**Stop:** do not split modules by line count, make SQLite authoritative, or introduce an interface whose normal behavior is “unsupported.”

## Parallel rollout measurement

Supervised-mode rollout measurement does not block the ordered hardening chain, but every cross-cutting fix must retain parity across:

| Runtime mode                   | Required evidence                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `in_process`                   | Baseline schemas, ordering, freshness, cancellation, mutation safety, and resource behavior. |
| `supervised`, recycle disabled | Relay parity without lifecycle churn; generation ownership and no retries.                   |
| `supervised`, recycle enabled  | Parity across recycle/respawn, stale-event rejection, cancellation, and index reuse/rebuild. |

Measure memory reclamation, cold/warm latency, cancellation, recycling, fallback, and failures across supported Node runtimes and representative repositories. Keep `in_process` as the immediate rollback unless evidence supports a default change.

## Later sequence

### Optional MCP-native synchronization progress

Use one transport-neutral observational seam and only emit bounded monotonic milestones when the client supplies a progress token. Bind each event to the original request and worker generation. Notification failure must never change synchronization, cancellation, mutation completion, or the final result.

### Bounded syntax-pattern discovery

Prototype a read-only playground or CLI spike for implementation shapes that symbol search and `ast_explore` do not answer well. Report `syntax` provenance, deterministic bounds, parse failures, and incomplete coverage. Retire it if value duplicates existing tools or a finite query language cannot bound work.

### Multi-language capability and evidence architecture

Add another language only for a concrete use case with an identified live analyzer/compiler authority. Negotiate reads, relationships, diagnostics, freshness, and mutation capabilities explicitly. Syntax-only adapters may discover candidates but cannot authorize semantic claims or mutations.

### Compute budgeting and semantic routing

Preregister benchmarks first. Semantic similarity may select candidates that compiler-backed operations validate; it never authorizes references, impact, tests, diagnostics, or mutations. Add further isolation only when the per-connection supervised worker has a measured deficiency.

## Operational surfaces and gates

| Initiative                | Public/result surface                                 | Operational evidence                                          | Mandatory gate                                                |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| Core authority            | Existing schemas plus the minimum correction metadata | Deterministic failure class and correlation                   | RED at filesystem/compiler/MCP boundary                       |
| Harness native visibility | Existing guarded tool surface                         | Scoped catalog, model result, durable event, replay, teardown | Exact pinned agent/session journey                            |
| Workspace boundary        | Bounded rejected-root error and capability signal     | Sanitized boundary/lifecycle outcomes                         | Simple repo, monorepo, symlink/config/reference escape matrix |
| Supervised rollout        | No schema change required                             | Mode, generation, recycle/crash/cancellation outcomes         | Memory, latency, parity, orphan-free lifecycle                |
| Sync progress             | Existing final result unchanged                       | Bounded milestone/drop/failure counts                         | Event cap, overhead, runtime parity                           |
| Syntax patterns           | Bounded `syntax` results                              | Parse/limit/failure classes                                   | Distinct value, latency, corpus coverage                      |
| Multi-language            | Negotiated capabilities/evidence tiers                | Analyzer/config readiness and degradation                     | Parity within each claimed capability                         |
| Semantic experiments      | Compiler authority unchanged                          | Routing outcomes without source/prompt leakage                | Recall gain after compiler validation                         |

Across all surfaces, errors remain bounded and free of credentials, raw environment values, source bodies, and private host paths. Benchmarks record “no implementation” when gates fail.

## Non-negotiable invariants

1. **Compiler authority:** exact diagnostics, selectors, references, impact, affected tests, and mutations come from a synchronized live compiler/analyzer.
2. **Explicit MCP identity:** MCP operations require `project_root`; CLI discovery never becomes ambient MCP selection.
3. **Bounded honest evidence:** finite work/output bounds and explicit omissions prevent partial evidence from looking complete.
4. **Explicit provenance:** compiler, syntax, index, and heuristic evidence are not interchangeable.
5. **Canonical serialization:** JSON is canonical; TOON is optional, bounded, lossless, and decode-validated.
6. **Mutation discipline:** prepare, review, hash, apply, diagnostics, workspace identity, conflict, rollback, receipt, and replay remain one safety chain.
7. **Scheduler/lifecycle ownership:** queueing, cancellation, deadlines, completion-critical phases, and worker generation ownership remain authoritative.
8. **No arbitrary shell execution:** no generic command runner, interpolation, caller executable, or subprocess pipeline enters the tool surface.
9. **Exact external proof:** host compatibility claims require the exact pinned host, bridge, package, executable, and agent/session boundary.

## Explicit non-goals

- Enabling Harness apply before native approval and session/workspace binding.
- Treating MCP annotations, UI rendering, or environment configuration as mutation authority.
- A shared daemon/worker pool without evidence that the per-connection worker is insufficient.
- Heuristic, embedding, syntax, or SQLite authority over exact evidence.
- Multi-language mutation without live analyzer freshness, conflicts, and reviewed apply.
- A second worker/IPC architecture for progress or a feature-specific scheduler.

## Source documents and accepted decisions

Detailed release and backlog evidence:

- [v0.13 Harness hardening evidence annex](ast-mcp-server-harness-improvement-report.md)

Accepted decisions:

- [ADR 0010: local stdio runtime governance](adr/0010-local-stdio-runtime-governance.md)
- [ADR 0011: SQLite default](adr/0011-promote-sqlite-default.md)
- [ADR 0012: public affected-test candidates](adr/0012-public-affected-test-candidates.md)
- [ADR 0013: atomic `ast_explore` presentation](adr/0013-ast-explore-presentation.md)
- [ADR 0014: supervised compiler worker](adr/0014-supervised-compiler-worker.md)
- [ADR 0015: DeepSeek Harness first slice](adr/0015-harness-adapter-first-slice.md)

Pinned upstream evidence remains DeepSeek Harness `dsh-v0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc`. A newer canary may reveal drift, but it cannot replace the pinned compatibility identity.

## Next decision

Continue issue-first with **R-01, then F-01**. Require a minimal deterministic RED at each claim boundary before correction. M-01 and M-02 are closed on `main` with verified OpenSpec archives; apply remains denied. Keep UI specialization, Code Mode, output-vocabulary projection [#103](https://github.com/yailPeralta/ast-mcp-server/issues/103), and apply authorization separate from this core authority sequence.
