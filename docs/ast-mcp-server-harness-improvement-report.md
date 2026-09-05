# AST MCP Server v0.13.1 Harness Hardening Evidence Annex

> **Decision:** v0.13.1 is the released Harness-hardening baseline. H-01a, H-02, H-03, and H-05 are closed and released; reads, prepare, and preview remain available while apply is denied. Continue issue-first with core authority findings M-01, M-02, R-01, and F-01. UI specialization, Code Mode, and output-vocabulary projection remain separate.

This annex records detailed evidence and acceptance gates for the [project roadmap](roadmap.md). The roadmap owns priority and sequencing; this document preserves the released evidence and remaining proof requirements.

## Quick continuation path

1. Preserve the immutable v0.13.0 RED evidence and the released v0.13.1 H-01a/H-02/H-03/H-05 gates.
2. Open or confirm one issue before work on M-01, M-02, R-01, or F-01; begin with a deterministic RED at the claimed boundary.
3. Keep apply denied and keep UI specialization, Code Mode, and output-vocabulary projection [#103](https://github.com/yailPeralta/ast-mcp-server/issues/103) separate.

Do not reopen released Harness slices through broad refactoring or substitute a newer unpinned Harness build for their exact-host evidence.

## Audited identity

| Component              | Immutable identity                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| AST package            | `ast-mcp-server@0.13.1`; npm `latest` = `next` = `0.13.1`                                         |
| AST release Git commit | npm `gitHead`, tag, and GitHub Release: `27b80a3da169b473a3b5c5dfea69ed52903ed4c7`                |
| v0.13.1 npm integrity  | `sha512-jqgGoYs8fe7J+E25lZusLK4wV6sjM5n5qiWnfe1RJIxOFo1r5nbtcBr1a/fdSWTYf/37bUNkshQp86UrdBHOsA==` |
| v0.13.1 npm shasum     | `2de6ccfe89cb97b45f6ec9f1a17623db8492c744`                                                        |
| v0.13.0 release commit | `75302189733f40aba6a36a8379c5b1f65fc3bd84`                                                        |
| v0.13.0 npm integrity  | `sha512-vbna6hhjX+VlayTnrgWQ/EitxkBmhVza0az6J/MCpE14M4Yn50D4yTQZrrcjfCi05sVhJhWFGPnzv6VE3V9KIw==` |
| v0.13.0 npm shasum     | `166f95121a72f0b03c325cef586a211cd9107a24`                                                        |
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

The v0.13.1 release is bound to the identity above:

- npm `gitHead`, annotated tag, and GitHub Release target the exact release commit; registry integrity matches, and `latest` plus `next` resolve to `0.13.1`.
- Main CI run `33460585683`, Security run `33460585625`, publish run `33461292810`, public-registry verification run `33461385440`, and promotion retry `33461651288` are green.
- Promotion run `33461571363` changed `latest` successfully but its bounded readback timed out. The green idempotent retry is the authoritative final verification; the first run is retained rather than hidden.
- Harness exposes 15 server-qualified AST tools before removal, zero after removal, and 15 after reconnect. `mcp__ast__ast_apply_operation` stays absent and direct invocation is rejected.
- Native and rendered gates prove model/durable/replay visibility, cancellation join, retirement, shutdown, secret-safe diagnostics, and ordered cleanup without public fixture or Harness-host edits.

The immutable v0.13.0 public RED remains historical evidence for the defects corrected in v0.13.1; it is not rewritten as if those fixes had already shipped there. Authorized workspace confinement and the core authority findings below remain open.

## Prioritized findings

`Priority` records audit impact/severity, not execution order. The roadmap status ledger and next-decision section own sequencing; closed findings remain here to preserve historical severity.

| ID   | Priority | Finding                                                                                     | Evidence state                                                 | Primary owner                             |
| ---- | -------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| M-01 | P0       | Apply publication has a TOCTOU window against external writers.                             | Static-v0.13; deterministic RED required                       | AST                                       |
| M-02 | P0       | Diagnostic delta identity omits edit location.                                              | Static-v0.13; RED required                                     | AST                                       |
| R-01 | P0       | Public `call`/`contains` impact requests can have no scoped producer.                       | Static-v0.13; RED required                                     | AST                                       |
| H-01 | P0       | Successful structured results may not become model-visible native content.                  | Closed and released in v0.13.1; public v0.13.0 RED retained    | Harness bridge; AST mitigation released   |
| H-02 | P0/P1    | Refined/reused schemas may degrade through the pinned bridge.                               | Closed and released in v0.13.1; exact regression gate retained | Harness bridge + AST                      |
| C-01 | P0       | Embedded compiler behavior may differ from the project compiler.                            | Static dependency drift; differential RED required             | AST                                       |
| S-01 | P0       | The adapter does not enforce an authorized workspace root.                                  | Static-v0.13; exact-host escape RED required                   | AST mitigation; Harness sandbox preferred |
| F-01 | P1       | JSON and TOON success shapes still need executable MCP-boundary proof.                      | Schema correction released; runtime RED required               | AST                                       |
| C-02 | P1       | Semantic package boundaries are absent from workspace identity.                             | Static-v0.13; freshness/conflict RED required                  | AST                                       |
| H-03 | P1       | Harness transport timeout was shorter than AST's queue plus execution budget.               | Closed, archived, and released in v0.13.1                      | Adapter                                   |
| H-04 | P1       | Prepare and preview have no approved Harness continuation to apply.                         | Release-verified product gap                                   | Product + Harness authorization           |
| H-05 | P1       | Lifecycle needed agent/session, replay, removal/reconnect, shutdown, and rendered evidence. | Closed, archived, and released in v0.13.1                      | AST gate + Harness                        |
| T-01 | P1       | Affected-test proof reconstruction traverses relationships in both directions.              | Static-v0.13; cyclic graph RED required                        | AST                                       |
| B-01 | P1       | Batch fan-out does not stop sibling assignment or own all session cleanup.                  | Static-v0.13; runtime RED required                             | AST CLI                                   |
| P-01 | P2       | SQLite validation follows the canonical compiler scan and may not reduce search work.       | Static-v0.13; benchmark decision                               | AST                                       |
| A-01 | P2       | Endpoint identity and traversal logic remain duplicated.                                    | Static-v0.13; refactor only after parity gates                 | AST                                       |
| O-01 | P2       | Payload limits, public errors, and release documentation need consolidation.                | Mixed static/documentation evidence                            | AST                                       |

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

The unmerged #188 recovery candidate exposes at most 14 ordered root-class cells across `reference`, `import`, `export`, `extends`, `implements`, `call`, and `contains`, incoming before outgoing. Status precedence is `unfinished > unsupported > completed > not_applicable`. Only fresh, uncancelled, unexhausted coverage containing safe statuses can authorize `proven_empty`; cancellation and `work_limit` return no partial authority. Affected-test discovery freezes six incoming kinds and excludes `contains`.

**Required RED:** one positive and one negative contract case for every public relationship kind, including overloaded functions, methods, and constructors.

**Acceptance gate:** U1–U6 characterization is green, but the feature remains a recovery candidate blocked by approved #186 callable finality and #187 exact-once accounting. The four JSON/TOON tools retain `output_format` without a universal MCP `outputSchema`. Pinned Harness proof must show 15 guarded tools, absent apply, and direct `ast_apply_operation` as `UNKNOWN_TOOL`. Closed #161 supplies no delivery, approval, verification, archive, release, or merge authority.

### F-01 — Executable JSON/TOON contract

v0.13.1 removed the false universal `ast_get_impact` output schema. The remaining core-authority question is executable MCP-boundary proof for both success forms rather than schema-advertisement fidelity alone.

**Required RED:** exercise exact JSON and TOON calls through the registered MCP handler and fail if either accepted success shape cannot execute or losslessly decode.

**Acceptance gate:** JSON validates as the canonical object, TOON decodes losslessly to it, and the MCP boundary accepts both declared success forms.

## Harness interoperability findings

### H-01 — Model-visible successful results

The public v0.13.0 package returns `content: []` plus `structuredContent`. Issue #84 proved that the pinned bridge preserves the canonical value internally while the native model request, durable `tool/result`, and resumed replay receive only the non-useful empty-result marker.

**Released correction:** the adapter sets `AST_MCP_TEXT_PROJECTION=canonical_json`. The server preserves `structuredContent`, adds deterministic text only to successful empty-text results, retains existing text unchanged, and applies a shared supervised-transport frame budget. The exact-host gate binds the same value across raw, native, model, durable, and resumed replay evidence.

**Preferred long-term ownership:** Harness should render bounded deterministic text when structured content exists and text content is empty. The AST mitigation remains adapter-only and removable if the pinned integration adopts equivalent behavior.

### H-02 — Published schema fidelity

`ast_explore` uses cross-field refinements, and other schemas reuse components or publish keywords that the pinned bridge may not preserve. Exact `tools/list` and scoped Harness schemas are the boundary evidence; Zod source shape alone is not.

The v0.13.0 public package deterministically published `ast_explore` as `{"type":"object","properties":{}}` (SHA-256 `8243f0af…`). The v0.13.1 correction registers the direct object schema, reapplies all three refinements inside the handler, and removes the false universal `ast_get_impact` output schema. Its scoped-registry and native-model schema hashes match (`41deb923…`), all other model tool definitions retain hash `428d0ab3…`, and the Harness registry rejects all three cross-field invalid combinations.

**Acceptance gate:** required inputs remain visible, invalid combinations still fail closed, no relevant field degrades silently to `any`/`{}`, and multi-format output exceptions are explicit. Native mode intentionally carries input schemas only; global projection of MCP output vocabularies into Harness remains the separate contract tracked by [#103](https://github.com/yailPeralta/ast-mcp-server/issues/103).

### H-03 — Timeout ownership

The published v0.13.0 patch did not set `toolCallTimeoutMs`. v0.13.1 ships one machine-readable tuple: queue `30000`, execution `120000`, margin `15000`, and outer `180000` milliseconds. Validation requires the strict order `180000 > 30000 + 120000 + 15000`; equality, missing values, non-integers, or a non-positive margin fail closed.

The evidence identity remains Harness `dsh-v0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc` with bridge `0.1.2-alpha.1`. The ordered H-03 chain is PR #109 at `d0cf9417b9fd0e23ddda568f2df2872b47aaa253`, PR #111 at `b5850296e09ccf93958211070ef6d96ba09cbb2f`, PR #113 at `3d31fb38a2b29b7ef40d879bbd356414fcfacb1d`, and closure PR #115 at `7ab04c29a274156c78c470eb7bc3488ce057b928`. H-03 is archived, closed, and released in v0.13.1.

**Delivered exact-host outcome**

| Path     | AST-owned terminal evidence   | Correlation and exclusion evidence                                                              |
| -------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Cold     | `OPERATION_DEADLINE_EXCEEDED` | Request-local call, fixture, correlation, and generation join.                                  |
| Queued   | `QUEUE_WAIT_TIMEOUT`          | No later `started` event; request-local submission identity survives terminal evidence.         |
| Recycled | `REQUEST_CANCELLED`           | Warm generation `1` recycles to owning generation `2`; stale-generation settlement is rejected. |

The guarded catalog remains exactly 15 tools. `ToolTimeoutError` and `TOOL_TIMEOUT` are forbidden outcomes, as is an unrelated `AbortError` classification. Cleanup/readback reports active, held, and listener counts at zero; two events drained; zero owned processes; and removed disposable profile/control state. The current `DSH_PROBE_RESULT` raw-marker SHA-256 is `a42076a676cce36c0166e106abff8f56cbbf2e93ce258b729ee888dab028d7f0`; the post-`finally` cleanup-evidence SHA-256 is `cfcf12cf078e4066857cc68d0dc22bb3da3cc9f08fe9a80605cc445e29b8e5de`.

**Released gate:** a slow fixture ends with AST's bounded operational error, not a generic bridge timeout; cancellation propagates in cold, queued, and recycled-worker cases. Preserve the shipped tuple and keep this H-03 evidence distinct from the later H-05 lifecycle evidence.

### H-04 — Prepare/preview continuation

The guarded profile exposes prepare and preview while apply is absent. Choose one explicit product contract:

1. read-only: hide prepare tools;
2. review-only: keep proposals but state that Harness cannot apply them;
3. approved apply slice: add host-native approval with workspace/session binding, unchanged plan hash, reconnect/restart/HMR expiry, and cross-workspace rejection.

Environment configuration alone is not approval authority.

### H-05 — User-visible lifecycle

**Status:** closed and released in v0.13.1. The merge chain is PR [#118](https://github.com/yailPeralta/ast-mcp-server/pull/118) (`6256391`), [#120](https://github.com/yailPeralta/ast-mcp-server/pull/120) (`ee80d5d`), [#122](https://github.com/yailPeralta/ast-mcp-server/pull/122) (`4d879ae`), [#124](https://github.com/yailPeralta/ast-mcp-server/pull/124) (`3dab418`), and release closure [#125](https://github.com/yailPeralta/ast-mcp-server/pull/125) (`27b80a3`).

The canonical archive is `openspec/changes/archive/2026-09-01-2026-08-30-h05-harness-lifecycle/`. The canonical spec contains 6 requirements and 12 scenarios; strict verification passed and Judgment was APPROVED.

The pinned native and rendered gates prove the exact catalog lifecycle `15 → 0 → 15`, request-local cancellation join, retirement and shutdown, and secret-safe ordered cleanup that runs every owner check even after an earlier cleanup failure. The slice required no public fixture or Harness-host edit. Apply remains absent and rejected.

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

## Released exact-host work unit

### H-01a — Native agent/session result visibility

**Status:** closed and released in v0.13.1 from approved issue [#84](https://github.com/yailPeralta/ast-mcp-server/issues/84).

The v0.13.0 public baseline reproduced the defect, and v0.13.1 corrected the smallest proven compatibility boundary without changing AST authority or enabling mutation. The contract below remains the immutable regression gate.

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
- the released correction produced one useful canonical JSON value whose raw, native, model, durable, and resumed replay hashes matched within the run;
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
