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
| Separate |                 2 |                2 |        11,514 |        536.19 ms |      377.54 MB |
| Batch    |                 1 |                2 |           552 |        535.24 ms |      378.35 MB |

That run reduced model round-trips by 50% and serialized context by 95.21%. Local execution latency decreased by 0.18% and RSS increased by 0.21%, both small enough to treat as noise rather than a performance claim. The batch value is orchestration/context reduction; it does not make TypeScript analysis free.

The checked model-facing format corpus used the complete MCP envelope for TOON:

| Payload             | Records | JSON tokens | MCP TOON tokens | Reduction |
| ------------------- | ------: | ----------: | --------------: | --------: |
| Broad symbol search |     100 |       5,225 |           3,881 |    25.72% |
| References          |      71 |       3,086 |           2,150 |    30.33% |
| Diagnostics         |      30 |       1,309 |           1,034 |    21.01% |
| Eligible aggregate  |     201 |       9,620 |           7,065 |    26.56% |

All seven positive and negative payloads round-tripped exactly. File list, outline, source, and prepare envelopes ranged from 5.50% to 23.40% worse in estimated tokens, which is why they remain JSON-only. Current serialized tool metadata is 2,451 characters smaller than the v0.3.0 baseline despite the three new input fields, because multi-shape tools no longer advertise a single incompatible output schema.
