# AST MCP Server Roadmap

> **Recommendation:** treat v0.13.0 as the published baseline, recover the core authority guarantees challenged by the v0.13 audit, and prove model-visible DeepSeek Harness behavior through the exact pinned host before adding more surface area. Keep apply denied in Harness until native approval and session/workspace binding exist.

This roadmap owns product status, sequencing, gates, and non-goals. The detailed findings, static evidence, and exact-host continuation contract live in the [v0.13 Harness hardening evidence annex](ast-mcp-server-harness-improvement-report.md).

## North star

Make `ast-mcp-server` the trustworthy structural intelligence layer for coding agents:

- live compilers or language analyzers authorize exact structural evidence and mutations;
- syntax indexes, semantic indexes, embeddings, and heuristics discover candidates only;
- every public result states provenance, freshness, bounds, and completeness honestly;
- mutations remain reviewable, hash-bound, conflict-aware, and recoverable;
- host integrations prove what the model and durable session receive, not only what a direct protocol call returns.

The goal is not to become a generic search daemon, command runner, or host-specific fork. The goal is a small predictable structural interface with evidence that survives each supported runtime boundary.

## Released baseline: v0.13.0

Release evidence binds `v0.13.0` to `75302189733f40aba6a36a8379c5b1f65fc3bd84`. npm `latest` and `next` both resolved to 0.13.0 when verified on 2026-08-29.

| Foundation                            | Released state                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Evidence contracts                    | Bounded, fresh, provenance-bearing results distinguish complete negatives from incomplete evidence.                            |
| Mutation workflow                     | Prepare, preview, hash-bound apply, diagnostics, conflict checks, rollback, receipts, and replay protections are present.      |
| Derived persistence                   | Native SQLite remains replaceable and non-authoritative; compiler reads are the fallback.                                      |
| Test impact and exploration           | Affected-test candidates and `ast_explore` expose bounded compiler-derived evidence with omission metadata.                    |
| Agent setup and operations            | Managed skill setup, upgrades, doctor diagnostics, and CLI project discovery are shipped.                                      |
| Runtime isolation                     | Opt-in supervised compiler workers use a bounded generation-aware relay; `in_process` remains the rollback.                    |
| Diagnostic summaries and capabilities | Exact bounded aggregates and one immutable tool catalog shipped in v0.12.0.                                                    |
| DeepSeek Harness first slice          | The published package mounts through the official pinned MCP bridge and exposes reads, prepare, and preview with apply denied. |
| Registry installation                 | A fresh pinned-Harness install discovers 15 AST tools; `ast_apply_operation` remains absent.                                   |

Released describes immutable product history, not proof that every intended invariant is satisfied. The v0.13 audit identifies static risks and exact-boundary gaps that now require RED evidence and bounded correction.

## Decision and status ledger

| Status                   | Direction                                                                                      | Decision posture                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Shipped**              | v0.13.0 baseline and guarded Harness first slice                                               | Preserve release history; correct documentation drift without rewriting evidence.    |
| **Next**                 | v0.13 correctness and Harness hardening                                                        | Recover core authority, then prove exact-host model visibility and schemas.          |
| **Parallel**             | Supervised rollout measurement                                                                 | Measure independently; do not promote supervised mode by default without evidence.   |
| **Then**                 | Optional MCP synchronization progress                                                          | Begin only after hardening gates are green; progress remains observational.          |
| **Later**                | Bounded syntax-pattern discovery; multi-language capability/evidence architecture              | Prototype read-only discovery first and negotiate capabilities explicitly.           |
| **Benchmark-gated**      | Index direction, `ast_explore` compute budgeting, semantic routing, further isolation          | Implement only when preregistered evidence clears a threshold. “No change” is valid. |
| **Rejected / non-goals** | Generic executor, heuristic authority, shared daemon/pool by default, generic throwing backend | Reopen only with a new problem statement and contradictory evidence.                 |

Statuses express sequencing, not implementation authorization.

## v0.13 correctness and Harness hardening

### 1. Recover core authority

**Scope:** M-01, M-02, R-01, F-01.

- Make apply publication fail closed against external writers and overlapping configurations.
- Make diagnostic deltas edit-aware.
- Ensure every public relationship kind has real bounded coverage or returns explicit incomplete/unsupported evidence.
- Make JSON and TOON success shapes executable at the MCP boundary.

**Entry:** each finding has a minimal deterministic RED at the boundary of the claim.

**Exit:** mutation conflicts, diagnostic additions, relationship negatives, and multi-format output are mechanically defensible in both runtime modes where applicable.

**Stop:** do not combine these into a broad refactor, and do not accept a unit-only reproduction when the defect is at filesystem or MCP publication.

### 2. Prove model-visible Harness interoperability

**Scope:** H-01, H-02, H-03, H-05.

The evidence annex's **H-01a native agent/session result visibility** work unit is candidate-verified in approved issue [#84](https://github.com/yailPeralta/ast-mcp-server/issues/84). The immutable public v0.13.0 baseline reproduced the empty native result, and the adapter-only candidate preserved one lossless value across raw capture, native presentation, the next model request, durable storage, and cold Agent resume/replay. Chained delivery remains pending.

Continue with separate bounded work units:

- deliver H-01a without widening the guarded 15-tool surface;
- prove H-02 exact scoped input/output schemas without silent `{}`/`any` degradation;
- prove H-03 transport timeout outside the complete server queue/execution budget;
- complete H-05 cancellation, reconnect, removal, public-error, shutdown, and GUI lifecycle evidence.

**Entry:** the exact public registry artifact and source-built pinned host are available in an isolated profile. Missing prerequisites block rather than skip.

**Exit:** native mode has one host-mediated invocation for every promised capability class, apply absence plus rejected invocation, durable resume/replay evidence, and zero leaked processes/state.

**Stop:** direct MCP, config dump, or registry-only success cannot substitute for the agent/session boundary. Do not expand to `ptc`, `both`, UI specialization, or apply while native schema and lifecycle gates remain open.

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

Detailed active evidence:

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

Deliver the candidate-verified **H-01a native agent/session result visibility** correction through reviewable chained slices. Preserve the exact public RED baseline as a mandatory regression gate. After H-01a merges, execute only H-02 schema fidelity against the same pinned host identity; keep timeout, remaining lifecycle, UI, Code Mode, and apply work separate.
