# AST MCP Server v0.13.0 Harness Hardening Evidence Annex

> **Decision:** keep the published DeepSeek Harness surface at reads, prepare, and preview with apply denied. The next delivery must first reproduce one model-visible result failure through the exact pinned Harness agent/session path. Core authority findings remain separate AST-owned blockers and must be proved by their own RED tests before implementation.

This annex records detailed evidence and acceptance gates for the [project roadmap](roadmap.md). The roadmap owns priority and sequencing; this document owns the supporting observations, open questions, and proof requirements.

## Quick continuation path

H-01a reproduced the native result-visibility defect against the immutable public baseline and verified an adapter-only correction in issue [#84](https://github.com/yailPeralta/ast-mcp-server/issues/84). Its implementation remains a delivery candidate until the chained review slices merge.

1. Deliver the bounded projection and exact-host lifecycle gate without widening the guarded surface.
2. Preserve the immutable public RED baseline and same-invocation raw/model/durable/replay evidence.
3. After H-01a merges, execute H-02 schema fidelity against the same pinned host identity.
4. Keep H-03 timeout ownership and the remaining H-05 lifecycle cases separate.

Do not begin with apply enablement, UI presentation, broad refactoring, or a newer unpinned Harness build.

## Audited identity

| Component              | Immutable identity                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| AST package            | `ast-mcp-server@0.13.0`                                                                           |
| AST release Git commit | `75302189733f40aba6a36a8379c5b1f65fc3bd84`                                                        |
| npm integrity          | `sha512-vbna6hhjX+VlayTnrgWQ/EitxkBmhVza0az6J/MCpE14M4Yn50D4yTQZrrcjfCi05sVhJhWFGPnzv6VE3V9KIw==` |
| npm shasum             | `166f95121a72f0b03c325cef586a211cd9107a24`                                                        |
| Harness host           | `dsh-v0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc`                                |
| MCP bridge             | `@deepseek-ai/dsh-mcp-client` source version `0.1.2-alpha.1` from the same Harness revision       |
| Adapter                | Published `cordis.patch.yml` from the AST package; package-relative `dist/index.js` resolution    |
| Guard                  | Published patch fixes `AST_MCP_APPLY_GUARD=deny`                                                  |

Every runtime receipt must additionally record the resolved Node executable/version, package path, bridge path, profile identity, and tarball digest. Those values are run-specific evidence and must not be hard-coded from one machine.

## Evidence vocabulary

| Label                  | Meaning                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Release-verified**   | Previously proved through the exact published package and pinned Harness identity.                                                |
| **Candidate-verified** | Proved on an unmerged delivery branch through the required exact runtime gate; not yet released behavior.                         |
| **Static-v0.13**       | Confirmed in the exact v0.13 source tree with a fresh compiler-backed read or direct configuration read. It is not runtime proof. |
| **RED required**       | A plausible defect or missing contract that still requires a failing test at the boundary being claimed.                          |
| **Upstream-owned**     | The durable correction belongs in Harness or its bridge; AST may provide a bounded compatibility mitigation.                      |

No item in this annex is a PASS for a gate that was not executed at its exact runtime boundary.

## Verified published baseline

The following facts were established for the immutable identity above on 2026-08-29:

- `ast-mcp-server@0.13.0` is published on npm and both `latest` and `next` resolve to it.
- A fresh registry install through pinned Harness succeeds with `dsh plugin --profile <profile> add ast-mcp-server@0.13.0`.
- Harness discovers 15 server-qualified AST tools.
- `mcp__ast__ast_apply_operation` is absent from discovery and direct invocation is rejected.
- The published patch uses the official MCP bridge, resolves the AST entrypoint package-relatively, and pins `AST_MCP_APPLY_GUARD=deny`.
- The shipped smoke proves package identity, configuration composition, discovery, registry-level read/prepare/preview invocation, and apply denial.

That baseline does **not** prove that successful results reach the model, that replay preserves them, that every published schema survives the bridge, or that the stdio child is confined to an authorized workspace.

## Prioritized findings

| ID   | Priority | Finding                                                                                      | Evidence state                                                 | Primary owner                             |
| ---- | -------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| M-01 | P0       | Apply publication has a TOCTOU window against external writers.                              | Static-v0.13; deterministic RED required                       | AST                                       |
| M-02 | P0       | Diagnostic delta identity omits edit location.                                               | Static-v0.13; RED required                                     | AST                                       |
| R-01 | P0       | Public `call`/`contains` impact requests can have no scoped producer.                        | Static-v0.13; RED required                                     | AST                                       |
| H-01 | P0       | Successful structured results may not become model-visible native content.                   | Candidate-verified in #84; delivery pending                    | Harness bridge; AST mitigation prepared   |
| H-02 | P0/P1    | Refined/reused schemas may degrade through the pinned bridge.                                | Static-v0.13; exact-host schema RED required                   | Harness bridge + AST                      |
| C-01 | P0       | Embedded compiler behavior may differ from the project compiler.                             | Static dependency drift; differential RED required             | AST                                       |
| S-01 | P0       | The adapter does not enforce an authorized workspace root.                                   | Static-v0.13; exact-host escape RED required                   | AST mitigation; Harness sandbox preferred |
| F-01 | P1       | `ast_get_impact` registers one output schema but can return a TOON envelope.                 | Static-v0.13; MCP execution RED required                       | AST                                       |
| C-02 | P1       | Semantic package boundaries are absent from workspace identity.                              | Static-v0.13; freshness/conflict RED required                  | AST                                       |
| H-03 | P1       | Harness transport timeout is shorter than AST's default queue plus execution budget.         | Static configuration; exact-host slow RED required             | Adapter                                   |
| H-04 | P1       | Prepare and preview have no approved Harness continuation to apply.                          | Release-verified product gap                                   | Product + Harness authorization           |
| H-05 | P1       | The shipped smoke does not prove agent/session visibility, durable replay, or GUI lifecycle. | Native visibility/replay candidate-verified; lifecycle remains | AST gate + Harness                        |
| T-01 | P1       | Affected-test proof reconstruction traverses relationships in both directions.               | Static-v0.13; cyclic graph RED required                        | AST                                       |
| B-01 | P1       | Batch fan-out does not stop sibling assignment or own all session cleanup.                   | Static-v0.13; runtime RED required                             | AST CLI                                   |
| P-01 | P2       | SQLite validation follows the canonical compiler scan and may not reduce search work.        | Static-v0.13; benchmark decision                               | AST                                       |
| A-01 | P2       | Endpoint identity and traversal logic remain duplicated.                                     | Static-v0.13; refactor only after parity gates                 | AST                                       |
| O-01 | P2       | Payload limits, public errors, and release documentation need consolidation.                 | Mixed static/documentation evidence                            | AST                                       |

## Core authority findings

### M-01 — External-writer-safe apply publication

`applyOperation()` verifies preimages, stages files, verifies preimages again, and then publishes with `rename` or `link`. The workspace lock coordinates AST participants by configuration identity; it is not a compare-and-swap primitive for editors, formatters, generators, or overlapping configurations.

**Required RED**

- Inject an external write after the final preimage read and before the first replace.
- Cover two configurations that share one physical file.
- Cover a multi-file operation with a competing write between replacements.
- Prove external bytes survive and the operation fails closed.

**Acceptance gate:** publication authenticates the displaced preimage atomically or declares the unsupported platform and refuses the operation. Rollback must restore only bytes owned by the operation.

### M-02 — Edit-aware diagnostic delta

The v0.13 diagnostic identity is code, category, file, and message. It omits line and column, so a new diagnostic inside an edited span can cancel an older diagnostic with the same textual identity.

**Required RED:** replace an existing error with a same-code/message error inside the edit while an unrelated shifted diagnostic remains stable.

**Acceptance gate:** matching is edit-aware and conservative inside replaced spans without turning harmless line shifts into false added errors.

### R-01 — Honest relationship coverage

The public relationship vocabulary includes `reference`, `import`, `export`, `extends`, `implements`, `call`, and `contains`. The scoped resolver used by impact installs producers for the first five groups but no equivalent producer for `call` or `contains`. An empty traversal therefore needs an explicit unsupported/incomplete outcome rather than a complete negative.

**Required RED:** one positive and one negative contract case for every public relationship kind, including overloaded functions, methods, and constructors.

**Acceptance gate:** every `proven_empty` result records that all requested kinds ran within budget; unsupported coverage is explicit and incomplete.

### F-01 — Executable JSON/TOON contract

`ast_get_impact` registers the canonical impact `outputSchema`, while `formattedResult()` returns `{format:"toon",data}` for TOON. The exact MCP call must prove whether SDK output validation rejects that alternate shape.

**Acceptance gate:** JSON validates as the canonical object, TOON decodes losslessly to it, and the MCP boundary accepts both declared success forms.

## Harness interoperability findings

### H-01 — Model-visible successful results

The public v0.13.0 package returns `content: []` plus `structuredContent`. Issue #84 proved that the pinned bridge preserves the canonical value internally while the native model request, durable `tool/result`, and resumed replay receive only the non-useful empty-result marker.

**Candidate correction:** the adapter explicitly sets `AST_MCP_TEXT_PROJECTION=canonical_json`. The server preserves `structuredContent`, adds deterministic text only to successful empty-text results, retains existing text unchanged, and applies a shared supervised-transport frame budget. The final exact-host run bound the same candidate raw value to native, model, durable, and resumed replay evidence. This remains candidate evidence until merged.

**Preferred long-term ownership:** Harness should render bounded deterministic text when structured content exists and text content is empty. The AST mitigation remains adapter-only and removable if the pinned integration adopts equivalent behavior.

### H-02 — Published schema fidelity

`ast_explore` uses cross-field refinements, and other schemas reuse components or publish keywords that the pinned bridge may not preserve. Exact `tools/list` and scoped Harness schemas are the boundary evidence; Zod source shape alone is not.

**Acceptance gate:** required inputs remain visible, invalid combinations still fail closed, no relevant field degrades silently to `any`/`{}`, and multi-format output exceptions are explicit.

### H-03 — Timeout ownership

The published patch does not set `toolCallTimeoutMs`. AST defaults to a 30-second queue wait plus a 120-second execution deadline. The outer transport must exceed the complete server budget plus bounded margin, or the profile must deliberately lower both server budgets.

**Acceptance gate:** a slow fixture ends with AST's bounded operational error, not a generic bridge timeout; cancellation still propagates in cold, queued, and recycled-worker cases.

### H-04 — Prepare/preview continuation

The guarded profile exposes prepare and preview while apply is absent. Choose one explicit product contract:

1. read-only: hide prepare tools;
2. review-only: keep proposals but state that Harness cannot apply them;
3. approved apply slice: add host-native approval with workspace/session binding, unchanged plan hash, reconnect/restart/HMR expiry, and cross-workspace rejection.

Environment configuration alone is not approval authority.

### H-05 — Gate the user-visible lifecycle

The H-01a candidate adds a real pinned agent/session journey, scoped discovery, same-invocation raw capture, model-visible result, durable event, cold Agent resume/replay, supervised framing, and owned process-tree teardown. Reconnect/removal, cancellation, public-error fidelity, and GUI lifecycle remain separate H-05 work.

## Compiler and workspace trust boundary

### C-01 — Compiler parity

The release declares `ts-morph@24.0.0`, while the lock resolves the project TypeScript range to 5.9.3. Treat a version difference as a risk, not proof of behavioral divergence.

**Required RED:** differential fixtures for NodeNext ESM, CommonJS, bundler resolution, JavaScript projects, decorators, and `import.meta`, comparing codes, categories, locations, and messages.

### S-01 — Authorized workspace root

`resolveTsConfigPath()` accepts an absolute config or directory and applies no configured allowed-root boundary. `cwd` in the Harness patch is not confinement.

**Acceptance gate:** canonical real paths for config, sources, project references, previews, and operations remain inside a host-authorized workspace across symlinks and both runtime modes.

### C-02 — Semantic inputs in freshness

`createWorkspaceSnapshot()` hashes compiler source files plus TypeScript configuration files. It does not explicitly add relevant `package.json` files, even though NodeNext `type`, `exports`, and `imports` affect semantics.

**Acceptance gate:** package-boundary changes trigger rebuild/freshness changes and invalidate prepared operations before writes.

### T-01 — Directed affected-test proofs

`findPathToRoot()` builds adjacency in both directions. In cyclic graphs it can select a relationship in the opposite direction from the authoritative incoming traversal.

**Acceptance gate:** store a directed predecessor during traversal, require each proof step to reduce depth toward the root, and keep reconstruction bounded and cancellable.

## Benchmark and refactor backlog

- **B-01:** stop new batch assignments on first failure, drain workers, and release batch-owned sessions/watchers/index handles.
- **P-01:** benchmark cold/warm P50/P95, RSS, visited symbols, and fallback rate before deciding whether SQLite should accelerate candidates or be simplified.
- **A-01:** consolidate endpoint identity and bounded traversal only behind parity tests; do not create a generic backend with routine unsupported failures.
- **O-01:** add a shared byte-budget policy, typed operational errors, current release/install documentation, and bounded preview handling.

## Completed exact-host candidate work unit

### H-01a — Native agent/session result visibility

**Status:** candidate-verified in approved issue [#84](https://github.com/yailPeralta/ast-mcp-server/issues/84); chained delivery pending.

The public baseline reproduced the defect and the candidate corrected the smallest proven compatibility boundary without changing AST authority or enabling mutation. The contract below remains the immutable regression gate.

**Immutable inputs**

- the identity tuple in this annex;
- a fresh isolated Harness profile and disposable workspace fixture;
- `tools.mode: native`;
- the exact public npm tarball after integrity readback;
- the source-built pinned bridge, with its resolved executable and package paths recorded;
- guaranteed teardown through success, failure, and missing-prerequisite paths.

**Host-mediated RED**

1. Start a real Harness agent/session, not an MCP-direct or registry-only probe.
2. Inspect the session-scoped tool catalog and confirm the expected guarded surface.
3. Ask the agent to invoke `mcp__ast__ast_get_project_status` for the disposable fixture.
4. Capture separately: raw tool response, model-visible result, durable `tool/result` event, and replayed Web/session result.
5. Assert the model-visible and replayed forms contain a bounded useful projection and correspond to the lossless structured value.
6. Reconfirm 15 discovered tools, apply absence, rejected direct apply invocation, and zero surviving processes/profile files after teardown.

**Required evidence**

- command shape and exit codes without raw credentials, environment, or private paths;
- host, bridge, Node, package, tarball, profile, and executable identities;
- scoped tool names and schemas;
- bounded raw/model/durable/replay result classifications and hashes;
- apply-denial evidence;
- cleanup readback.

**Observed outcome**

- the immutable public baseline produced the same 58-byte non-useful marker in native, model, durable, and resumed replay forms;
- the candidate produced one useful canonical JSON value whose raw, native, model, durable, and resumed replay hashes matched within the run;
- the guarded catalog remained 15 tools, apply remained absent/rejected, an escape-amplified result stayed within the supervised worker frame, and the owned process tree plus disposable state were removed;
- exact run-specific hashes and toolchain identities are recorded on issue #84 rather than hard-coded into this durable document.

**Stop conditions**

- Any identity mismatch or missing prerequisite is `BLOCKED`, never a green skip.
- MCP-direct success cannot substitute for the Harness agent/session boundary.
- If the result is already model-visible, record that H-01 did not reproduce and do not manufacture a fix.
- If evidence cannot be privacy-scrubbed or teardown is incomplete, stop before mutation.
- Do not expand to schemas, timeout, UI specialization, or apply in the same work unit.

## Verification matrix for later slices

| Axis                 | Required cases                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Harness presentation | `native` first; `ptc`/`both` only after native; scoped catalog; durable event and replay |
| AST runtime          | `in_process`; supervised without recycle; supervised with recycle                        |
| Node                 | Supported Node 22 floor and Node 24 line                                                 |
| TypeScript           | NodeNext ESM, CommonJS, bundler, JS config, nested package boundaries                    |
| Relationships        | Every public kind, overloads, cycles, and honest proven-empty evidence                   |
| Workspace            | Simple repo, monorepo, symlink escape, external config/reference                         |
| Operation            | Read, prepare, preview, denied apply, external writer, overlapping configs               |
| Lifecycle            | Cold start, queue, deadline, cancellation, reconnect, HMR/removal, shutdown              |
| Payload              | JSON, TOON, empty, large result, large diff, supported schemas                           |

## Explicit non-goals

- Do not enable `AST_MCP_APPLY_GUARD=allow` in Harness before native approval and session/workspace binding exist.
- Do not treat tool annotations, UI presentation, SQLite, syntax, or heuristics as safety authority.
- Do not promote supervised mode by default without the roadmap's rollout measurements.
- Do not broaden language support before TypeScript/compiler parity and capability negotiation are reliable.
- Do not split large modules merely by line count; extract proven contracts and keep parity evidence.
