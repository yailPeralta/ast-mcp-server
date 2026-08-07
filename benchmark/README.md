# Benchmark methodology

The benchmark suite measures structural payload reduction, batch orchestration, and model-facing result formats. The first two benchmarks deliberately avoid converting characters into tokens. The format benchmark pins and names one tokenizer so its estimates are reproducible rather than universal.

## Project payload and latency

`scripts/benchmark.mjs`:

1. Loads a real TypeScript project from disk.
2. Selects the lexicographically first non-declaration source files after an optional filter.
3. Serializes the default compact outline payload (`file` plus `outline`).
4. Also records the larger opt-in payload containing detailed symbol metadata.
5. Reports fresh project load, cold cached-session, warm cached-session, and per-file outline latency.

Run:

```bash
yarn benchmark /absolute/project/path --sample 20 --output benchmark/results/project.json
```

The selection rule is deterministic but not statistically representative of every repository. Use `--filter` and multiple samples when comparing particular modules.

## Compact-first task corpus

`task-corpus.json` defines twelve questions over this repository. Each task declares:

- files a full-file workflow would load;
- declarations a compact-first workflow would request after inspecting outlines;
- evidence strings necessary to answer that task.

`scripts/benchmark-corpus.mjs` compares:

- baseline: complete text of every declared file;
- compact: default outline payloads plus only the selected declaration sources.

It fails unless every predefined evidence string is present in the compact payload. This makes the check reproducible, but it does not prove that every possible reviewer would reach an equivalent conclusion.

Run:

```bash
yarn benchmark:corpus benchmark/task-corpus.json --output benchmark/results/self-corpus.json
```

## Interpreting results

- Character reduction measures serialized payload size, not billed model tokens.
- Negative reduction on a tiny file is valid: protocol structure can cost more than reading that file directly.
- Project-load latency and warm-session latency should be considered separately.
- Detailed symbol metadata is opt-in because it repeats signature text and can dominate small files.
- Benchmark scripts record absolute local paths and timestamps. Checked reports replace local paths with descriptive placeholders; regenerate them when comparing another machine or revision.

## Batch orchestration

`scripts/benchmark-batch.mjs` compares a two-operation search-to-source workflow in fresh Node processes:

- separate: the client receives the broad symbol-search payload, selects the first match, then requests its source;
- batch: `ast-tool` performs the same two MCP tool invocations in process and emits only the final source result.

Run:

```bash
yarn benchmark:batch --iterations 5 --output benchmark/results/self-batch.json
```

The report records logical model round-trips, actual tool invocations, median wall time, process maximum RSS, final-result characters, and total characters exposed to the model. It does not include model inference latency, so the practical wall-time benefit of removing a model round-trip will be larger than this local process-only comparison. Maximum RSS includes the Node runtime and TypeScript project in each fresh worker.

## Composed agent workflows

`benchmark/context-corpus.json` and `scripts/benchmark-agent-workflows.mjs` compare three read workflows over a deterministic TypeScript fixture:

- full-file: `ast_get_file` for the declared files;
- primitives: `ast_search_symbols` followed by exact source or reference retrieval;
- `ast_explore`: one bounded composed call with the required source/reference evidence.

Each scenario fails on missing evidence or a call bound violation. The report records conceptual model round-trips, actual MCP invocations, serialized characters/bytes, named `o200k_base` estimates, local duration, fallback state, unresolved items, and static `tools/list` metadata separately. It does not claim that a larger composed payload is cheaper; completeness and fewer model turns are the point of this workflow.

Run:

```bash
yarn benchmark:agent-workflows
```

The checked pre-5.4 run on 2026-08-05 with Node.js v24.16.0 exposed 14 tools and passed both corpus gates (`evidence_preserved` and `call_bounds_respected`). `ast_get_impact` was added afterward; historical workflow measurements remain labeled as such:

| Scenario / workflow          | Model turns | MCP calls | Characters | `o200k_base` |  Duration |
| ---------------------------- | ----------: | --------: | ---------: | -----------: | --------: |
| search-to-source / full      |           1 |         1 |        302 |          105 | 154.17 ms |
| search-to-source / primitive |           2 |         2 |        407 |          107 |  17.77 ms |
| search-to-source / explore   |           1 |         1 |        861 |          233 |   4.18 ms |
| multi-file / full            |           1 |         2 |        635 |          214 |   5.31 ms |
| multi-file / primitive       |           2 |         2 |        977 |          256 |  61.49 ms |
| multi-file / explore         |           1 |         1 |      1,643 |          436 |   3.90 ms |

`ast_explore` is intentionally richer than the primitive payload in these tiny fixtures because it carries routing, freshness, completeness, truncation, budget, source and reference metadata in one response. The benchmark measures the tradeoff instead of treating payload reduction as the sole success criterion. The generated report is `benchmark/results/self-agent-workflows.json`.

### Relationship and impact corpus

`benchmark/impact-corpus.json` adds five deterministic controls to the same benchmark command:

- direct compiler reference to a test file;
- unrelated same-name declaration, which must not become an edge;
- string-keyed dynamic dispatch, which must not create a guessed relationship;
- stale relationship freshness, which must fail candidate resolution closed;
- depth-truncated transitive impact, which must remain incomplete and fail candidate resolution closed.

The runner builds a separate fixture, collects compiler relationships, traverses the declared root with the declared budgets, and invokes the pure candidate resolver without executing tests. It fails if heuristic evidence is marked compiler-authoritative, a forbidden file enters the impact, stale/truncated evidence produces candidates, or any expected scenario diverges. The current closure report covers all five scenarios with `impact_corpus_pass`, `impact_no_heuristic_authority`, `impact_negative_controls_pass`, and `impact_candidate_fail_closed` set to `true`.

## Incremental symbol-index lifecycle

The `index_lifecycle` section of `scripts/benchmark-agent-workflows.mjs` measures the index independently from payload reduction:

- `initial_build_ms`: cold project synchronization and initial index build;
- `warm_query_ms`: direct indexed candidate query plus compiler selector validation;
- `changed_file_rebuild_ms`: synchronization after one source file changes;
- `config_rebuild_ms`: synchronization after the TypeScript configuration changes;
- `compiler_fallback_ms`: compiler search when the index is deliberately unavailable.

Run it with a temporary output when comparing revisions:

```bash
yarn benchmark:agent-workflows --output /tmp/ast-agent-workflows.json
```

The lifecycle numbers are observations, not an absolute latency gate. Initial and configuration rebuilds include compiler work; warm query is intentionally measured separately. The report also records whether fallback happened and how many indexed/compiler matches were returned.

The latest deterministic-fixture run on Node.js v24.16.0 recorded:

| Lifecycle             |  Duration |
| --------------------- | --------: |
| Initial index build   | 168.12 ms |
| Warm indexed query    |   0.47 ms |
| Changed-file rebuild  |  14.92 ms |
| Configuration rebuild |  80.60 ms |
| Compiler fallback     |   0.34 ms |

That run indexed one file, returned one warm match, returned one compiler-fallback match, and kept both existing workflow gates green. These values are local measurements on a tiny fixture, not production capacity claims.

## Symbol-index persistence evidence (disabled)

`scripts/benchmark-index-storage.mjs` evaluates disposable memory, JSON-file and native SQLite adapters behind the existing `SymbolIndexStore` boundary. It does not change the production backend, install a persistence dependency, download a runtime or write a tracked benchmark result.

The report covers:

- runtime identity and native SQLite capability;
- isolated package installation with lifecycle scripts disabled;
- body-free synthetic workload;
- conformance for load, query ranking/limits, schema filtering, project/config isolation, upsert, remove, clear and flush;
- clean restart, row-level schema migration with reopen verification, interrupted flush and malformed-storage recovery with exact entry-count verification;
- bounded concurrent writers, including the expected JSON lost-update negative control;
- a basic native-SQLite probe with two readers plus one writer;
- SQLite storage sizing including the main database, WAL and SHM sidecars;
- failure of the command when required durable evidence is false.

Run it with the declared floor using the explicit experimental SQLite flag:

```bash
PATH=/home/yail/.nvm/versions/node/v22.5.0/bin:$PATH \
NODE_OPTIONS=--experimental-sqlite \
INDEX_STORAGE_NODE22_5_BIN=/home/yail/.nvm/versions/node/v22.5.0/bin/node \
INDEX_STORAGE_NODE24_BIN=/home/yail/.nvm/versions/node/v24.16.0/bin/node \
yarn benchmark:index-storage --skip-package-smoke --output /tmp/ast-index-storage-node22.5.json
```

Long-running evidence can be isolated by backend and scenario. Focused runs skip package smoke automatically and still report runtime identity and configured runtime probes:

```bash
# SQLite row migration, including close/reopen and zero legacy rows
yarn benchmark:index-storage --backend sqlite --scenario migration \
  --output /tmp/ast-index-storage-sqlite-migration.json

# Concurrent writers for different project/config identities
yarn benchmark:index-storage --backend sqlite --scenario cross-project \
  --output /tmp/ast-index-storage-sqlite-cross-project.json

# JSON negative control for cross-project lost updates
yarn benchmark:index-storage --backend json --scenario cross-project \
  --output /tmp/ast-index-storage-json-cross-project.json
```

Supported backends are `all`, `memory`, `json`, and `sqlite`. Supported scenarios are `all`, `migration`, and `cross-project`; focused scenarios require `json` or `sqlite`. The default remains `--backend all --scenario all`.

Node 24 can run the same command without `NODE_OPTIONS`. The configured runtime binaries are probed explicitly and reported as `pass`, `fail` or `not_available`. Missing portable candidates are reported as unavailable rather than installed implicitly. The passing row migration and cross-project writer checks are not substitutes for multi-version rollback, the complete cross-project reader/writer matrix, compiler fallback or production observability; a passing benchmark does not authorize persistence.

## Model-facing JSON and TOON

`scripts/benchmark-formats.mjs` compares compact JSON with TOON for actual MCP logical results. It uses this repository for broad symbol search and deterministic temporary TypeScript fixtures for repeated references and non-empty diagnostics. File lists, outlines, exact source, and a prepared rename are retained as negative controls.

For each payload it records:

- exact JSON→TOON→value round-trip equality;
- UTF-8 bytes;
- `gpt-tokenizer@3.4.0` `o200k_base` token estimates;
- plain TOON for CLI output and the real MCP `{format,data}` envelope;
- median encode/decode time over 50 local iterations;
- serialized `tools/list` metadata against the checked v0.3.0 baseline.

Run:

```bash
yarn benchmark:formats
```

The script fails unless every round trip is exact, the broad-search MCP envelope reduces estimated tokens by at least 20%, and the aggregate eligible corpus reduces them by at least 15%. Tokenizer estimates are not provider usage records and do not establish billed-token or prompt-cache savings.

## Checked results

Results generated on 2026-08-03 with Node.js v24.16.0:

| Workload        |   Sample | Full source chars | Compact chars | Reduction | Fresh load | Warm session |
| --------------- | -------: | ----------------: | ------------: | --------: | ---------: | -----------: |
| This repository | 20 files |            77,982 |        12,512 |    83.96% |     543 ms |      1.86 ms |
| `x-scraper`     | 20 files |           178,110 |        17,036 |    90.44% |   3,951 ms |    180.16 ms |
| Task corpus     | 12 tasks |            83,289 |        28,372 |    65.94% |        n/a |          n/a |

The task corpus passed all 12 predefined evidence checks. Its compact count includes the selected declaration bodies, not just outlines. Exact raw reports are under `benchmark/results/`.

The checked broad search-to-source batch result used five fresh-process samples:

| Mode     | Model round-trips | Tool invocations | Context chars | Median wall time | Median max RSS |
| -------- | ----------------: | ---------------: | ------------: | ---------------: | -------------: |
| Separate |                 2 |                2 |         7,818 |        587.03 ms |      380.68 MB |
| Batch    |                 1 |                2 |           417 |        607.95 ms |      379.15 MB |

That run reduced model round-trips by 50% and serialized context by 94.67%. Local execution latency increased by 3.56% and RSS decreased by 0.40%, both small enough to treat as noise rather than a performance claim. The batch value is orchestration/context reduction; it does not make TypeScript analysis free.

The checked model-facing format corpus used the complete MCP envelope for TOON:

| Payload             | Records | JSON tokens | MCP TOON tokens | Reduction |
| ------------------- | ------: | ----------: | --------------: | --------: |
| Broad symbol search |     100 |       5,492 |           4,191 |    23.69% |
| References          |      71 |       3,094 |           2,159 |    30.22% |
| Diagnostics         |      30 |       1,309 |           1,034 |    21.01% |
| Eligible aggregate  |     201 |       9,895 |           7,384 |    25.38% |

All seven positive and negative payloads round-tripped exactly. File list, outline, source, and prepare envelopes were 5.13% to 13.56% worse in estimated tokens, which is why they remain JSON-only. The historical eleven-tool metadata snapshot is 3,372 serialized characters larger than the retained v0.3.0 baseline; this static protocol cost predates later additive tools and is reported separately from dynamic result savings.

The checked result-shaping corpus compares the v0.4.0-compatible `full/100/context` profiles with the new public defaults across exact-name, exact-path, prefix, broad-substring, and multi-file-reference workflows:

| Profile   | Logical calls | MCP TOON tokens |
| --------- | ------------: | --------------: |
| Baseline  |             6 |           3,910 |
| Candidate |             6 |           1,220 |

Every declared selector and reference coordinate remained present, and the aggregate reduction was 68.80%, above the checked 35% gate. `duration_ms` is omitted from both measured representations to make token counts deterministic; real JSON/TOON outputs are still decode-compared before measurement. These are local `o200k_base` estimates, not provider billing, cache, or latency evidence.

The historical complete v0.5.0 `tools/list` metadata was 22,473 serialized characters versus the retained v0.4.0 value of 16,650 (`+5,823`). Removing only `ast_scaffold_class` from that historical list reduced it by 5,411 characters and 1,295 local `o200k_base` tokens. No v0.4.0 token count was retained, so the report intentionally leaves the historical token delta unset. The post-5.4 result-shaping run measured 15 tools and 38,240 serialized metadata characters; its full JSON output was verified separately from these historical workflow tables.
