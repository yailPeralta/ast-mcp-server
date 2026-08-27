# AST MCP Server Roadmap

> **Recommendation:** preserve compiler authority, measure the released supervised runtime, and use the v0.12.0 diagnostic and capability foundations to validate one pinned DeepSeek Harness Developer Preview integration. Follow with optional synchronization progress, syntax-pattern discovery, and only then broader language or semantic-routing work.

This roadmap consolidates product direction after the fully released `v0.12.0` state. It is a decision aid, not approval to implement every item. Each lasting public contract or cross-module seam still requires its own bounded decision and verification evidence.

## North star

Make `ast-mcp-server` the trustworthy structural intelligence layer for coding agents:

- live compilers or language analyzers authorize exact structural evidence and mutations;
- syntax indexes, semantic indexes, embeddings, and heuristics discover candidates only;
- every public result states its provenance, freshness, bounds, and completeness honestly;
- mutations remain reviewable, hash-bound, conflict-aware, and recoverable.

The goal is not to become a generic search daemon or command runner. The goal is to expose deep, language-aware behavior through a small, predictable interface.

## Released baseline: v0.12.0

Release evidence records `v0.12.0` at `3991d0a74e672c6c4d3fbd1c8bbb1a60009515ec`. This describes the released product, not the current checkout or its `HEAD`.

| Foundation           | Released state                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Evidence contracts   | Bounded, fresh, provenance-bearing results distinguish complete negatives from incomplete evidence.                                                    |
| Mutation safety      | Operations follow prepare → review → hash → apply with diagnostics, conflict, rollback, receipt, and replay protections.                               |
| Derived persistence  | Native SQLite accelerates symbol lookup but remains replaceable and non-authoritative; memory is the fail-closed fallback.                             |
| Test impact          | Affected-test candidates retain compiler-authoritative relationship proof and proven-empty semantics.                                                  |
| Exploration          | `ast_explore` admits whole evidence clusters, preserves omissions, and supports MCP/batch parity.                                                      |
| Agent setup          | The managed skill bundle is installable and upgradeable without weakening local ownership or safety.                                                   |
| Operations           | `ast-tool doctor` reports privacy-safe, bounded diagnostics.                                                                                           |
| CLI ergonomics       | CLI-only nearest `tsconfig.json`/`jsconfig.json` discovery fails on ambiguity; MCP still requires explicit identity.                                   |
| Runtime isolation    | Opt-in supervised compiler workers reclaim idle memory behind a bounded generation-aware relay.                                                        |
| Diagnostic summaries | Opt-in diagnostic aggregates are exact, page-independent projections of one synchronized compiler collection with explicit covered and omitted counts. |
| Tool capabilities    | One immutable descriptor catalog derives batch, compatibility, and agent projections while typed tool modules retain schema and behavior ownership.    |

`in_process` remains the default and immediate rollback. Supervised mode is an available operational choice, not the new authority model.

## Decision and status ledger

| Status                   | Direction                                                                                                   | Decision posture                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Shipped**              | The v0.12.0 foundation above, including exact diagnostic aggregates and the tool/capability descriptor seam | Maintain and verify; do not reopen without contradictory evidence.                                                           |
| **Next**                 | Supervised rollout measurement; pinned DeepSeek Harness Developer Preview interoperability                  | Run measurement independently; validate the official MCP client path without creating a second execution or authority model. |
| **Then**                 | Optional MCP synchronization progress                                                                       | Keep progress observational and reuse the shipped descriptor and supervised-runtime foundations.                             |
| **Later**                | Bounded syntax-pattern playground/search; multi-language capability and evidence architecture               | Prototype read-only discovery first; require explicit capability negotiation.                                                |
| **Benchmark-gated**      | `ast_explore` compute budgeting; semantic routing; further process isolation                                | Implement only when preregistered evidence clears a decision threshold. “No change” is a valid outcome.                      |
| **Rejected / non-goals** | Generic executor, heuristic authority, shared daemon/pool by default, generic throwing backend              | Do not plan these without a new problem statement and evidence that invalidates the rejection.                               |

Statuses express sequencing, not implementation authorization. Moving an item to “Next” means it deserves a bounded initiative, not that its interface has been approved.

## Ordered macro sequence

### 1. Maintain the roadmap and measure supervised rollout

**Entry:** v0.12.0 is the released baseline and the roadmap sources have been reconciled against it.

Measure memory reclamation, cold/warm latency, cancellation, worker recycling, fallback, and failure behavior across supported Node runtimes and representative repositories. Track release state separately from checkout state.

**Exit:** maintainers have a reproducible report with thresholds, rollback signals, and known platform limits.

**Stop:** do not promote supervised mode by default when evidence is narrow, regresses latency or reliability, or cannot prove behavioral parity.

### 2. Exact bounded diagnostic aggregates — shipped in v0.12.0

**Entry:** normalized compiler diagnostics remained the single input and the aggregate contract was independently bounded.

The released slice adds deterministic summaries such as top files and diagnostic codes without replacing exact diagnostic records. Aggregation caps, covered counts, omitted counts, and page independence are explicit.

**Exit:** aggregates are exact projections of one synchronized diagnostic collection, add no false completeness, and preserve existing canonical JSON/lossless TOON behavior.

**Stop:** abandon or narrow the slice if grouping depends on formatted compiler output, pagination changes totals, or bounds cannot be explained mechanically.

### 3. Narrow tool/capability descriptor seam — shipped in v0.12.0

**Entry:** registration, batch, compatibility, and agent inventories had parity tests.

The released seam centralizes static tool facts so inventories derive from one small interface while typed tool implementations keep ownership of schemas and behavior. It deepens the module by reducing caller knowledge and fan-out.

**Exit:** generated projections match current behavior, unsupported combinations are rejected statically, and contributors have one obvious place for shared metadata.

**Stop:** reject the design if it becomes a generic executor, erases per-tool typing, or introduces backend methods whose normal behavior is to throw “unsupported.”

### 4. Validate DeepSeek Harness Developer Preview interoperability

**Entry:** v0.12.0 capability descriptors have parity evidence, and the evaluation pins DeepSeek Harness `dsh-v0.1.2-alpha.1` at revision `cd5ef8148158c3a752a658978873241fdf8e2bbc` plus `@deepseek-ai/dsh-mcp-client@0.1.2-alpha.1` rather than treating Developer Preview behavior as stable.

Ship a thin adapter whose package declares exactly `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`. Its patch mounts the packaged `ast-mcp-server` stdio command through the official [`@deepseek-ai/dsh-mcp-client`](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/mcp/mcp-client/README.md); it does not duplicate AST tools. Because Harness does not resolve the MCP binary automatically, the adapter resolves the entrypoint relative to its own installed package and proves that resolution from the packed tarball.

Do not promise `dsh plugin --profile web add ast-mcp-server@<exact-version>` until a published, tested adapter tarball contains that patch. `dsh --profile web --dump-config` proves composition only; a separate runtime smoke must prove package-relative resolution, stdio startup, discovery, and invocation. Start with Harness [`tools.mode: native`](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/core/tools/README.md#configure-the-presentation-mode). Keep `ptc` (Code Mode) and `both` benchmark-gated because `run_code` reduces error fidelity, and keep [ACP](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/acp/acp/README.md) out because it exposes Harness agents rather than importing MCP tools.

The official bridge drops MCP `tool.annotations`, including `readOnlyHint` and `destructiveHint`, and launches stdio outside the Harness sandbox. The first supported surface is therefore reads plus prepare and preview, with `apply` denied by a guard. A later apply claim requires explicit proof of root/session binding, review/hash binding, explicit approval, workspace-change rejection, reconnect/restart/HMR/expiry behavior, and zero cross-workspace authorization.

**Exit:** a reproducible report pins both products and the adapter tarball; proves installation, config composition, and the separate runtime smoke; preserves explicit `project_root`, schemas, structured results, error evidence, cancellation, and the guarded first surface; and removes cleanly without repository or protocol changes.

**Stop:** do not claim compatibility if the tarball lacks its patch, binary resolution depends on ambient `PATH`, the adapter duplicates tools, the guard can expose `apply`, annotation loss becomes authority, stdio must be presented as sandboxed, Code Mode hides required errors, or the path relies on unpinned or undocumented Harness behavior.

**Risks:** Developer Preview and patch-schema churn; package-relative entrypoint drift; lost annotations; unsandboxed child execution; public-name changes; stale tools across reconnect/HMR; guard expiry or workspace leakage; and reduced Code Mode error fidelity.

**Non-goals:** duplicating AST tools, treating annotations or Code Mode as authority, enabling `apply` in the first delivery, adding ACP or Streamable HTTP, patching Harness core, or claiming remote/multi-tenant support.

### 5. Add optional MCP-native synchronization progress

**Entry:** the descriptor seam provides consistent request-capability wiring, and the MCP client supplies a progress token.

Expose bounded, monotonic milestones for cold creation, rebuilds, configuration invalidation, and derived-index refresh. Progress is best-effort observation: clients without support receive unchanged final results.

Progress must reuse the existing supervised runtime and relay. It introduces no second worker model, second IPC architecture, scheduler, or compiler owner.

**Exit:** progress is request- and generation-affine, rejects stale worker events, emits no duplicate or retry-derived events, preserves cancellation, discloses no paths, and cannot affect result authority.

**Stop:** do not ship if notification failure can change synchronization, freshness, cancellation, mutation completion, or the final result.

### 6. Prototype bounded syntax-pattern discovery

**Entry:** a representative corpus contains structural questions that symbol search, `ast_explore`, and text search do not answer well.

Start with a read-only playground or CLI spike for implementation shapes. Report `syntax` provenance, deterministic bounds, parse failures, and incomplete coverage explicitly. MCP exposure requires separate value and operational evidence.

**Exit:** the spike demonstrates distinct recall/value at acceptable latency and payload size without implying semantic relationships.

**Stop:** retire it if results duplicate existing tools, provenance is confusing, or a safe finite query language cannot prevent excessive work.

### 7. Establish multi-language capability and evidence architecture

**Entry:** at least one additional language has a concrete user case and an identified live analyzer or compiler authority.

Negotiate capabilities explicitly instead of pretending every adapter supports the TypeScript surface. Normalize shared evidence vocabulary where it is truly common; keep language-specific facts behind language-owned modules. Syntax-only adapters may discover candidates but cannot authorize semantic claims.

**Exit:** clients can determine supported reads, relationships, diagnostics, freshness, and mutations without probing failures; every evidence tier has explicit provenance and completeness behavior.

**Stop:** do not add multi-language mutation until that language has live analyzer authority, freshness, conflict detection, and an equivalent reviewed-apply safety model.

### 8. Evaluate compute budgeting and semantic routing

**Entry:** preregistered benchmarks identify a user-visible cost or discovery gap that existing bounds do not solve.

- For `ast_explore`, measure phase costs before designing a deterministic compute budget.
- For semantic routing, use similarity only to select candidates that compiler-backed operations then validate.
- For additional isolation, measure why the existing per-connection supervised worker is insufficient.

**Exit:** measurements demonstrate a stable dominant cost or material recall gain, a deterministic policy, bounded overhead, privacy compatibility, and a safe rollback.

**Stop:** implement nothing when measurements are inconclusive, gains disappear after compiler validation, or the policy would hide heuristics behind authoritative-looking results.

## Runtime-mode proof matrix

Every cross-cutting capability must prove equivalent public behavior in these modes:

| Runtime mode                   | Required evidence                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `in_process`                   | Baseline schemas, ordering, freshness, cancellation, mutation safety, and resource behavior.                 |
| `supervised`, recycle disabled | Relay parity without lifecycle churn; generation ownership and no retries.                                   |
| `supervised`, recycle enabled  | Parity across idle recycle/respawn, stale-event rejection, cancellation, and derived-index reuse or rebuild. |

For progress specifically, bind every event to the original request, progress token, and worker generation. A recycled or crashed generation cannot publish into its successor, forwarded requests are never retried, and notification delivery never participates in the semantic result.

## Operational surfaces and gates

This is a **directional candidate mapping**, not approval to add any public field or surface. Each initiative must justify its own minimum projection through a bounded decision; existing surfaces remain unchanged until that decision is accepted. Not every initiative belongs on every surface, and approved work should expose only evidence that helps a caller or operator act.

| Initiative                   | Candidate public result                                                | Candidate `ast-tool doctor` projection          | Candidate project-status projection         | Candidate sanitized internal evidence                                 | Required benchmark gate                                                                            |
| ---------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Supervised rollout           | No schema change                                                       | Mode, configured recycle policy, bounded health | Current mode/generation health when safe    | Recycle, crash, stale-reply, cancellation outcomes                    | Memory, latency, parity, orphan-free lifecycle                                                     |
| Diagnostic aggregates        | Exact bounded aggregate object                                         | Registration/schema availability only           | None                                        | Correlation and bounded failure class                                 | Determinism, overhead, page independence                                                           |
| Descriptor seam              | No behavior change                                                     | Inventory consistency                           | Capability projection where already public  | Descriptor validation failures                                        | Registration and type/parity gates                                                                 |
| Harness MCP interoperability | Existing MCP schemas and results through server-qualified native tools | Client registration and pinned Harness identity | None                                        | Startup, discovery, reconnect, timeout, and sanitized failure classes | Native schema/result/error parity, latency, cancellation, reconnect; separate Code Mode comparison |
| Sync progress                | Existing final result unchanged                                        | Capability/support signal                       | Synchronization state remains authoritative | Bounded milestone/drop/failure counts                                 | Event cap, overhead, runtime-mode parity                                                           |
| Syntax patterns              | Bounded results with `syntax` provenance                               | Parser/query support                            | Optional readiness only if stateful         | Parse/limit/failure classes, no source body                           | Distinct value, latency, corpus coverage                                                           |
| Multi-language               | Negotiated capabilities and evidence tiers                             | Analyzer/config readiness                       | Per-language freshness and degradation      | Sanitized adapter lifecycle outcomes                                  | Parity within each claimed capability                                                              |
| Explore/semantic experiments | Existing authority preserved                                           | Experimental availability only                  | Derived-index readiness, never truth        | Budget/routing outcomes without prompt/source leakage                 | Preregistered cost, recall, validation, privacy thresholds                                         |

Across all surfaces:

- public errors remain bounded, actionable, and free of credentials, raw environment values, source bodies, and unsafe paths;
- project status reports runtime/readiness evidence, not semantic conclusions;
- internal logs use safe correlation and opaque project identity;
- benchmarks use representative corpora and record “no implementation” when gates fail.

## Non-negotiable invariants

1. **Compiler authority:** exact diagnostics, selectors, references, impact, affected tests, and mutations come from a synchronized live compiler/analyzer.
2. **Explicit MCP identity:** MCP operations require `project_root`; CLI convenience discovery never becomes ambient MCP selection.
3. **Bounded and honest evidence:** collections and work have deterministic finite bounds; omissions and truncation make completeness false where applicable.
4. **Explicit provenance:** `compiler`, `syntax`, semantic-index, and heuristic evidence are not interchangeable.
5. **Canonical serialization:** JSON is canonical; TOON is optional, lossless, decode-validated, and used only at the model-facing boundary.
6. **Mutation discipline:** prepare → review → hash → apply remains the only mutation path, including diagnostics delta, workspace fingerprint, conflicts, rollback, receipt, and replay rules.
7. **Scheduler and cancellation ownership:** per-project scheduling, cooperative checkpoints, deadlines, queue limits, and completion-critical phases remain authoritative.
8. **No arbitrary shell execution:** no generic command runner, shell interpolation, caller-supplied executable, or subprocess pipeline enters the tool surface.

## Explicit non-goals

- A shared daemon or worker pool unless measurements prove a problem the per-connection supervised runtime cannot solve.
- Heuristic, embedding, syntax-index, or SQLite authority over exact evidence or mutations.
- A generic backend interface whose adapters routinely throw for unsupported methods.
- Multi-language mutation before a live language analyzer can provide freshness and reviewed-apply authority.
- Default promotion of supervised mode without representative rollout evidence and a proven `in_process` rollback.
- A second worker/IPC architecture for progress or any feature-specific scheduler.

## Source documents and accepted decisions

The local opportunity documents are analysis inputs; they are not part of the public v0.12.0 tree, and some status language predates v0.12.0, so they must not override released-product evidence:

- RTK-inspired architecture opportunities — `docs/rtk-architecture-opportunities.md`
- CocoIndex opportunities — `docs/cocoindex-opportunities.md`
- External project and multi-language opportunities — `docs/external-project-opportunities.md`

Accepted decisions that constrain this roadmap:

- [ADR 0010: local stdio runtime governance](adr/0010-local-stdio-runtime-governance.md)
- [ADR 0011: SQLite default](adr/0011-promote-sqlite-default.md)
- [ADR 0012: public affected-test candidates](adr/0012-public-affected-test-candidates.md)
- [ADR 0013: atomic `ast_explore` presentation](adr/0013-ast-explore-presentation.md)
- [ADR 0014: supervised compiler worker](adr/0014-supervised-compiler-worker.md)

Pinned upstream evidence for the Developer Preview initiative:

- [DeepSeek Harness `dsh-v0.1.2-alpha.1` overview](https://github.com/deepseek-ai/deepseek-harness/tree/cd5ef8148158c3a752a658978873241fdf8e2bbc)
- [Plugin and capability architecture](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/docs/architecture.md)
- [Official MCP client](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/mcp/mcp-client/README.md)
- [Native, PTC/Code, and combined tool presentation](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/core/tools/README.md)
- [ACP automation server boundary](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/acp/acp/README.md)

## Next decision

Publish and maintain this roadmap as the single macro decision ledger. Then create one bounded compatibility spike for **DeepSeek Harness Developer Preview interoperability** using the official MCP client over stdio and native tool presentation. The spike must freeze both product identities and may end with no compatibility claim.

Supervised rollout measurement can proceed independently in parallel. It informs runtime defaults and cross-cutting verification, but it does not need to block the interoperability spike.
