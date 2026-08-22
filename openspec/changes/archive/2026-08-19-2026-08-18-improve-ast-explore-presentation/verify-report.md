```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:7174a517a7a3da470914c6fde077643e186159075589558c5544d2c54486c349
verdict: pass
blockers: 0
critical_findings: 0
requirements: 4/4
scenarios: 12/12
test_command: yarn test
test_exit_code: 0
test_output_hash: sha256:068d018e261267b3eb0ad25074f004944ca5326b30358bf62ca53f8fa13aeda2
build_command: yarn build
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: `2026-08-18-improve-ast-explore-presentation`
**Version**: N/A
**Mode**: Strict TDD
**Artifact store**: Hybrid

### Verdict

**PASS** — all four requirements and twelve scenarios have passing runtime coverage. Fresh quality gates and 53-file/748-test execution pass; retained read-only evidence proves exactly two successful benchmark runs, schema-v4/observation separation, all six gates, and byte/mode/mtime convergence without a prohibited third run.

### Completeness

| Metric                                    | Value |
| ----------------------------------------- | ----: |
| Requirements                              |     4 |
| Scenarios                                 |    12 |
| Tasks total                               |    15 |
| Tasks complete                            |    15 |
| Tasks incomplete                          |     0 |
| Requirements with implementation evidence |   4/4 |
| Scenarios with passing covering tests     | 12/12 |

### Artifact and Mirror Retrieval

- Filesystem artifacts read in full: proposal, four specs, design, tasks, and apply-progress under `openspec/changes/2026-08-18-improve-ast-explore-presentation/`.
- Engram artifacts read in full: proposal `#1057`, concatenated spec `#1058`, design `#1060`, tasks `#1061`, and cumulative apply-progress `#1068`.
- Tasks and apply-progress are semantically identical across the two stores, with only the trailing newline omitted by command capture. The concatenated spec is semantically identical modulo formatting separators. Proposal and design Engram observations preserve their pre-Prettier formatting while the filesystem holds the normalized presentation; the declared scope, requirements, and design decisions agree.
- Actual count from the retrieved specs: **4 requirements / 12 scenarios**.

### Spec Compliance Matrix

| Requirement                   | Scenario                    | Implementation evidence                                                                                                             | Passing runtime test                                                                                                                             | Result       |
| ----------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Bounded cluster presentation  | Stable page                 | `presentExploreClusters` fixed-point UTF-8 accounting and whole-cluster admission                                                   | `test/explore-presentation.test.ts > produces a stable atomic page with exact fixed-point bytes`                                                 | ✅ COMPLIANT |
| Bounded cluster presentation  | Oversized symbol            | `presentExploreClusters` selector-only downgrade and consumed-record pagination                                                     | `test/explore-presentation.test.ts > downgrades an oversized cluster atomically and advances by the consumed symbol`                             | ✅ COMPLIANT |
| Bounded cluster presentation  | Default compatibility       | `buildExploreContext` performs call projection only when `request.callSpines` is present                                            | `test/context-builder.test.ts > preserves default ranking without requesting call traversal`; public default assertion in `test/explore.test.ts` | ✅ COMPLIANT |
| Categorized bounded omissions | Budget                      | Presenter omission aggregation plus call-spine truncation projection in `buildExploreContext`                                       | parameterized presenter `budget` case; MCP bounded `max_nodes: 1` case                                                                           | ✅ COMPLIANT |
| Categorized bounded omissions | Incomplete                  | Presenter completeness becomes false for incomplete omissions; call planner distinguishes incomplete discovery                      | parameterized presenter `incomplete` case; `test/call-spines.test.ts > classifies empty authority`                                               | ✅ COMPLIANT |
| Categorized bounded omissions | Untrusted negative control  | `collectCompilerCallRelationships` emits only exact compiler-resolved call edges; planner withholds stale/non-exact authority       | parameterized presenter `untrusted` case; relationship negative controls; empty-authority stale case                                             | ✅ COMPLIANT |
| Exact authoritative spines    | Call classification         | `collectCompilerCallRelationships` accepts resolved calls, constructors, and tagged templates and keeps generic references separate | `test/relationships.test.ts > classifies only compiler-resolved call, constructor, and tagged-template sites`; MCP exact-spine case              | ✅ COMPLIANT |
| Exact authoritative spines    | Bounded canonical traversal | `planCallSpines` uses stable layer ordering, relationship-ID tie breaks, cycle suppression, and explicit depth/node/edge reasons    | `test/call-spines.test.ts > selects the stable shortest tie without repeating cycle endpoints`; incoming-order and bounded-exhaustion cases      | ✅ COMPLIANT |
| Exact authoritative spines    | Empty authority             | `planCallSpines` sets `empty_proven` only for authoritative, complete, non-truncated emptiness                                      | parameterized `test/call-spines.test.ts > classifies empty authority`                                                                            | ✅ COMPLIANT |
| MCP-handler parity            | Equivalent execution        | `READ_BATCH_TOOLS` admits `ast_explore`; `runBatchDocument` invokes the registered tool result                                      | `test/mcp.integration.test.ts > keeps ast_explore direct, batch, JSON, and TOON results logically equivalent`                                    | ✅ COMPLIANT |
| MCP-handler parity            | Root or bound failure       | `injectProjectRoot` rejects conflicting roots; registered handler preserves bounded tool errors                                     | root-conflict and too-small-byte assertions in the parity integration test                                                                       | ✅ COMPLIANT |
| MCP-handler parity            | Final serialization         | CLI serializes one logical batch result; TOON decodes to JSON-equivalent meaning                                                    | JSON/TOON equality assertions in the parity integration test                                                                                     | ✅ COMPLIANT |

**Compliance summary**: **12/12 scenarios compliant at runtime**.

### Static Correctness Evidence

Compiler-backed inspection used the AST MCP surface; no textual search was presented as compiler evidence.

| Requirement                   | Source symbols inspected through AST MCP                                                      | Status         |
| ----------------------------- | --------------------------------------------------------------------------------------------- | -------------- |
| Bounded cluster presentation  | `presentExploreClusters`, `buildExploreContext`                                               | ✅ Implemented |
| Categorized bounded omissions | `presentExploreClusters`, `buildExploreContext`, `ExploreOutputSchema`                        | ✅ Implemented |
| Exact authoritative spines    | `collectCompilerCallRelationships`, `planCallSpines`, `ExploreInputSchema`, `registerExplore` | ✅ Implemented |
| MCP-handler parity            | `READ_BATCH_TOOLS`, `injectProjectRoot`, `runBatchDocument`, `registerExplore`                | ✅ Implemented |

AST project status was fresh and compiler-ready with canonical snapshot `snapshot_366310fa2f50d1753f80c7edf03532669d738bc3f3d3f7a62ebdb8aa193ed65c`. File-scoped diagnostics were zero for:

- `src/services/relationships.ts`
- `src/services/call-spines.ts`
- `src/services/explore-presentation.ts`
- `src/services/context-builder.ts`
- `src/tools/explore.ts`
- `src/batch/schema.ts`

Project-wide AST diagnostics retain three pre-existing TS1470 `import.meta`/CommonJS findings in `src/index.ts` and `src/server.ts`. The canonical repository `yarn typecheck` passed and no changed source file has an AST diagnostic.

### Design Coherence

| Design decision                                   | Followed? | Evidence                                                                                                                       |
| ------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Pure presentation boundary                        | ✅ Yes    | `explore-presentation.ts` owns atomic variants, omission aggregation, and byte planning.                                       |
| Live exact compiler call projection plus pure BFS | ✅ Yes    | `relationships.ts` projects only compiler-resolved invocation sites; `call-spines.ts` performs deterministic path planning.    |
| Registered handler reused by read batch           | ✅ Yes    | `ast_explore` is in `READ_BATCH_TOOLS`; the batch runner injects the authoritative root and invokes the registered MCP result. |
| No default call work                              | ✅ Yes    | `buildExploreContext` projects calls only for an explicit exact-symbol `callSpines` request.                                   |
| No generic-reference relabeling                   | ✅ Yes    | Generic relationship collection remains separate and the covering test proves it emits no `call` edge.                         |

### Task Completion Matrix

| Phase                           | Tasks   | Status      | Current evidence                                                                     |
| ------------------------------- | ------- | ----------- | ------------------------------------------------------------------------------------ |
| PR1 exact call-spine foundation | 1.1–1.3 | ✅ Complete | 18/18 relationship/call-spine tests within focused-unit 31/31 pass                   |
| PR2a atomic presentation core   | 2.1–2.3 | ✅ Complete | Presenter/context tests within focused-unit 31/31 pass                               |
| PR2b public contract            | 3.1–3.3 | ✅ Complete | Public schema 1/1 and registered MCP spine 1/1 pass                                  |
| PR3 batch/evidence/remediation  | 4.1–5.3 | ✅ Complete | Parity/cancellation pass; focused benchmark 11/11; retained convergence proof passes |

### Command Evidence

All output hashes bind the exact captured stdout/stderr bytes.

| Command                                                                                                                                                                                        | Environment / purpose                  | Exit | Output bytes | SHA-256                                                            | Result                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---: | -----------: | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `yarn format:check`                                                                                                                                                                            | sandbox, check-only                    |    0 |           66 | `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` | ✅                                                         |
| `yarn lint`                                                                                                                                                                                    | sandbox                                |    0 |            0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | ✅                                                         |
| `yarn typecheck`                                                                                                                                                                               | sandbox                                |    0 |            0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | ✅                                                         |
| `yarn test test/relationships.test.ts test/call-spines.test.ts test/explore-presentation.test.ts test/context-builder.test.ts`                                                                 | focused unit/compiler/service evidence |    0 |          233 | `8827662165fb5309db83149c7f2a04d15e89ec964f760541a9d16cd09c5cf912` | ✅ 4 files / 31 tests                                      |
| `yarn test test/explore.test.ts -t "publishes additive call-spine and omission controls without changing defaults"`                                                                            | public contract                        |    0 |          243 | `6dcf5b5a399c343a9d7225174c3bf22cf49ffc5f407e7a1d3a6d7a20df78d2dc` | ✅ 1/1                                                     |
| `yarn test test/mcp.integration.test.ts -t "exposes exact compiler call spines and bounded omission metadata"`                                                                                 | registered MCP contract                |    0 |          245 | `8f4919b25fffe5b3d4cc93c3feb1986cdd2b8c21d81e636be3285c8ce00a1573` | ✅ 1/1                                                     |
| `yarn test test/mcp.integration.test.ts -t "keeps ast_explore direct, batch, JSON, and TOON results logically equivalent\|cancels queued ast_explore work without returning partial evidence"` | batch parity and cancellation          |    0 |          245 | `8a2b86fb3b60253ffba631699c238513f5e631b7ab9bab73d206ce4f85791a43` | ✅ 2/2                                                     |
| `yarn test test/benchmark-agent-workflows.test.ts`                                                                                                                                             | fresh focused benchmark contract       |    0 |          233 | `acf0867ea0f76c1547c56fc4c7bc64372c8ce07983bbf1760f16f65f10dbf412` | ✅ 1 file / 11 tests                                       |
| `env -u GIT_PAGER yarn test`                                                                                                                                                                   | fresh clean-environment full suite     |    0 |          462 | `068d018e261267b3eb0ad25074f004944ca5326b30358bf62ca53f8fa13aeda2` | ✅ 53 files / 748 tests                                    |
| retained `recovery-full-test.log`                                                                                                                                                              | reused read-only runtime evidence      |    0 |          462 | `25124ce2f9d5cdcb2d8e4910ead812f94f83ed677ad890ebf00097f31fdde754` | ✅ 53 files / 748 tests                                    |
| `yarn build`                                                                                                                                                                                   | sandbox                                |    0 |            0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | ✅                                                         |
| benchmark script/package wrapper                                                                                                                                                               | prohibited; no third runtime run       |    — |            — | —                                                                  | ⏹ read-only retained evidence used                         |
| convergence logs/hash/cmp/schema inspection                                                                                                                                                    | read-only                              |    0 |            — | —                                                                  | ✅ exactly two runs; six gates; identical bytes/mode/mtime |
| settlement-manifest hash checks                                                                                                                                                                | read-only                              |    0 |            — | —                                                                  | ✅ all listed artifacts match                              |
| process cleanup inspection                                                                                                                                                                     | read-only                              |    0 |            — | —                                                                  | ✅ no verification Vitest/Yarn/benchmark process remains   |

Fresh execution supplies formatter, lint, typecheck, focused benchmark, full-suite, and build proof. The two-run benchmark and the earlier 53-file/748-test log are reused only as read-only corroboration; the benchmark runtime was not executed again.

### Runtime Convergence and Candidate Immutability

The remediation settlement and retained run artifacts were hash-checked before use; current tracked evidence was compared byte-for-byte with the retained run-1 bytes.

| Evidence                         | Value                                                                     |
| -------------------------------- | ------------------------------------------------------------------------- |
| Settlement manifest              | `sha256:d2b02c93593bd044e3f8e0d7476877a8bb220c56ca849b368b925b039376bd54` |
| Native remediation accounting    | `76/300` changed lines                                                    |
| Benchmark runtime runs           | Exactly `2`                                                               |
| Run 1                            | Exit 0; six gates true; `changed:true`                                    |
| Run 2                            | Exit 0; six gates true; `changed:false`                                   |
| Retained/current tracked SHA-256 | `56038cac3b1c9da1d6aa1c5e26a981cb3f36389e791262105c59ceddaa244d75`        |
| Byte comparison / size           | Equal / `8,580` bytes                                                     |
| Mode / mtime                     | `664` / epoch `1787172575` on both retained and current bytes             |
| Schema separation                | Tracked v4 has no volatile keys; observation v1 retains raw measurements  |
| Prettier proof                   | `sha256:17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` |

Conditional publication is exact: volatile observation bytes are written first, false gates throw before tracked publication, and successful tracked bytes use an exact conditional write. The focused 11/11 test covers every false gate, alias controls, revalidation, import safety, and no-op publication. No third benchmark run occurred.

### TDD Compliance

| Check                         | Result | Details                                                                                                                              |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| TDD evidence reported         | ✅     | Full cumulative table present in filesystem apply-progress and Engram `#1068`                                                        |
| All tasks have tests          | ✅     | 15/15 tasks map to declared test or runtime evidence                                                                                 |
| RED confirmed                 | ✅     | All declared test files exist; apply-progress preserves the initial failing hashes and does not relabel historical broad failures    |
| GREEN confirmed               | ✅     | Fresh benchmark 11/11 and fresh full suite 748/748 pass; cumulative apply evidence preserves every earlier green                     |
| Triangulation adequate        | ✅     | Positive, negative, bounded, direction, cycle/tie, authority, root-conflict, serialization, and cancellation cases vary expectations |
| Safety net for modified files | ✅     | Each work unit records its pre-edit safety net and current focused/full regression evidence                                          |

**TDD compliance**: **6/6 checks passed**.

### Test Layer Distribution

| Layer                 | Tests executed for this change |      Files | Tool                                     |
| --------------------- | -----------------------------: | ---------: | ---------------------------------------- |
| Unit/compiler-service |                             31 |          4 | Vitest                                   |
| Integration/MCP       |                             15 |          3 | Vitest + in-memory/registered MCP server |
| E2E/runtime smoke     |                    read-only 2 | 2 run logs | Retained benchmark convergence evidence  |
| **Focused total**     |                         **46** |      **7** |                                          |

The fresh repository-wide suite additionally executed 748 Vitest cases across 53 files.

### Changed File Coverage

Coverage analysis skipped — the repository does not declare or install `@vitest/coverage-v8` or `@vitest/coverage-istanbul`. This is not a failure.

### Assertion Quality

✅ No trivial assertion was found in the eight related test files audited (`relationships`, `call-spines`, `explore-presentation`, `context-builder`, `explore`, `mcp.integration`, `batch`, and `benchmark-agent-workflows`). There are no `.only`, `.skip`, debugger, or console-debug residues. Type-only preconditions are paired with behavioral assertions; mock/assertion ratios stay below the warning threshold.

### Quality Metrics

**Formatter**: ✅ Repository-wide check passed
**Linter**: ✅ No errors or warnings
**Type checker**: ✅ Canonical typecheck passed; changed-source AST diagnostics are zero
**Build**: ✅ Passed
**Coverage**: ➖ Not available
**Diff hygiene**: ✅ Verification changed no source, test, benchmark, tasks, or apply-progress bytes

### Daily Engineering Quality Gate

- [x] Focused verification ran and passed.
- [x] Broader verification ran and passed in the valid clean environment.
- [x] Names, comments, and public contracts were inspected through compiler-backed symbols.
- [x] Presentation, call projection, traversal, and batch boundaries remain separated as designed.
- [x] Performance bounds were exercised by focused tests and retained two-run benchmark evidence.
- [x] Trust, cancellation, empty/stale/incomplete, root-conflict, and byte/node/edge limits were considered.
- [x] Candidate source and evidence bytes remained immutable during final verification.
- [x] Remaining risk is explicit.

### Issues Found

**CRITICAL**

None.

**WARNING**

1. Project-wide AST diagnostics expose three pre-existing TS1470 findings under the AST server's CommonJS diagnostic view, while canonical `yarn typecheck` and every changed-source diagnostic pass.
2. `scripts/benchmark-agent-workflows.mjs` is outside the active tsconfig; its disclosed textual inspection is not compiler-backed. Fresh lint/build/full-suite and focused 11/11 runtime coverage mitigate this limitation.

**SUGGESTION**

None.

### Native Settlement Evidence

| Field                  | Value                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Attempt work unit      | `final-sdd-verification-after-benchmark-remediation`                                                                                          |
| Supplied attempt token | `sha256:8cf5c1ed5279486560391238bfd381fc905107825097122e69d018ee8f8a0851`                                                                     |
| Outcome                | `passed`                                                                                                                                      |
| Evidence revision      | `sha256:7174a517a7a3da470914c6fde077643e186159075589558c5544d2c54486c349`                                                                     |
| Diagnosis              | Historical benchmark mutation is resolved by deterministic v4 projection, volatile v1 observations, gate-first publication, and no-op writes. |
| Harness disposition    | Fresh gates passed; retained exactly-two-run convergence evidence was verified read-only; no third benchmark run occurred.                    |
| Cleanup evidence       | Only the admitted verify report may change; the repository-local candidate file is removed after persistence.                                 |
| Process evidence       | Every launched command reached a terminal exit; no verification Vitest/Yarn/benchmark process remains.                                        |

This report is the canonical verification-evidence preimage. Validator admission, exact report SHA-256, changed-line accounting, and hybrid parity are recorded after persistence.
