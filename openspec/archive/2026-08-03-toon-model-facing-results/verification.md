# Verification

Verified on 2026-08-03 against Node.js v24.16.0 and Yarn 4.15.0.

## Requirement traceability

| Requirements                                         | Evidence                                                                                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AST-FORMAT-001`, `AST-FORMAT-002`, `AST-FORMAT-004` | `test/result-format.test.ts`; default JSON parity and closed-format input tests in `test/mcp.integration.test.ts`                                                            |
| `AST-FORMAT-003`                                     | TOON envelope assertions and decode equality in `test/result-format.test.ts`, `test/mcp.integration.test.ts`, and `scripts/mcp-smoke.mjs`                                    |
| `AST-FORMAT-005`                                     | Invalid canonical values, unsupported non-finite numbers, encoder and byte-limit failures in `test/result-format.test.ts`; MCP handlers route failures through `errorResult` |
| `AST-FORMAT-006`                                     | Decode/deep-equality checks in the presenter, adversarial integration fixtures, and every benchmark payload reporting `round_trip_equal: true`                               |
| `AST-FORMAT-007`                                     | Exact UTF-8 limits and 64 KiB error bound in `test/result-format.test.ts`; real final-output overflow with empty stdout in `scripts/cli-smoke.mjs`                           |
| `AST-BATCH-FORMAT-001`                               | Existing search-to-source `$ref`, projection, foreach and prepare tests in `test/batch.test.ts` and `scripts/cli-smoke.mjs`                                                  |
| `AST-BATCH-FORMAT-002`                               | Static, runtime whole-input and all-items-before-foreach-invocation rejection tests in `test/batch.test.ts`                                                                  |
| `AST-BATCH-FORMAT-003`                               | Full-envelope JSON/TOON serialization tests in `test/cli-output.test.ts`; JSON, explicit JSON and decoded TOON CLI smokes                                                    |
| `AST-BATCH-FORMAT-004`                               | Prepare-plus-TOON CLI smoke verifies rejection before execution and unchanged source                                                                                         |
| `AST-BATCH-FORMAT-005`                               | Typed `ENCODING_ERROR`/`OUTPUT_LIMIT` unit tests and real overflow smoke proving empty stdout plus JSON stderr                                                               |
| `AST-COMPAT-001`                                     | MCP integration and stdio smoke expose the same ten tool names; single-shape tools retain their schemas                                                                      |
| `AST-COMPAT-002`                                     | In-memory MCP integration and stdio smoke cover canonical JSON default and explicit structured TOON envelope                                                                 |
| `AST-COMPAT-003`                                     | `benchmark/results/self-formats.json` records 19,101 baseline versus 16,650 current serialized metadata characters (`-2,451`, `-12.83%`)                                     |
| `AST-COMPAT-004`                                     | Exact `@toon-format/toon@4.1.0` and `gpt-tokenizer@3.4.0` package/lock entries; immutable install, tarball smoke and clean audit                                             |
| `AST-MEASURE-001`, `AST-MEASURE-002`                 | `scripts/benchmark-formats.mjs`, `benchmark/README.md`, and checked `benchmark/results/self-formats.json`                                                                    |
| `AST-MEASURE-003`                                    | Broad symbol-search MCP-envelope token reduction: 25.72%; eligible aggregate: 26.56%; both benchmark gates pass                                                              |
| `AST-MEASURE-004`                                    | File-list, outline, source and prepare negative controls justify leaving those result shapes JSON-only                                                                       |
| `AST-DOC-001`                                        | `README.md`, `CHANGELOG.md`, `docs/adr/0002-toon-at-model-boundary.md`, and bundled skill version 3.4.0                                                                      |

## Commands and observed results

- `yarn format:check`: passed; all matched files use Prettier style.
- `yarn lint`: passed with zero findings.
- `yarn typecheck`: passed for source and test TypeScript configs.
- `yarn test`: passed, 15 files and 75 tests.
- `yarn build`: passed.
- `yarn test:mcp`: passed over stdio with 10 tools and decoded TOON output.
- `yarn test:cli`: passed, including JSON default, explicit JSON, TOON, malformed flags, read failure, output overflow, prepare rejection, apply, replay and setup.
- `yarn test:package`: passed from an isolated tarball install; package version 0.4.0, lifecycle scripts disabled, global install and both agent targets verified.
- `yarn benchmark:formats`: passed all round-trip and reduction gates.
- `yarn install --immutable`: passed.
- `yarn audit`: passed with no audit suggestions after resolving Hono to 4.12.34; the exact quarantine exception is recorded in `.yarnrc.yml`.
- `yarn pack --dry-run`: includes the server/CLI distribution, `dist/cli-output.js`, README, changelog and bundled skill.
- `git diff --check`: passed.

## Benchmark decision

TOON remains opt-in and limited to symbol search, references and diagnostics. The measured MCP-envelope token reductions are 25.72%, 30.33% and 21.01% respectively. File list, outline, source and prepare controls are neutral or worse after envelope overhead, so they remain canonical JSON.

No provider-billed-token or cache-saving claim is made; token counts use the checked local `o200k_base` tokenizer only.
