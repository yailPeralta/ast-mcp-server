# Tasks: TOON model-facing results

## 1. Contract and dependency

- [x] RED: add `test/result-format.test.ts` covering unchanged JSON mode, TOON envelope mode, output-schema rejection, round-trip equality, Unicode/delimiter/multiline strings and final byte limits.
- [x] RED: add an MCP integration assertion proving the installed SDK rejects the TOON envelope while a canonical output schema is registered; amend the design from that evidence.
- [x] Add exact-pinned `@toon-format/toon@4.1.0` runtime dependency with Yarn and update `yarn.lock` without enabling lifecycle scripts.
- [x] Extend `src/tools/result.ts` with the shared `json | toon` schema fragment and schema-validating presenter.
- [x] GREEN: run `yarn test test/result-format.test.ts test/mcp.integration.test.ts`.

## 2. Eligible MCP tools

- [x] RED: extend `test/mcp.integration.test.ts` for TOON search, references and non-empty diagnostics; assert one envelope, no duplicate content, exact decode and unchanged default mode.
- [x] Modify `src/tools/search_symbols.ts` to accept the shared optional `output_format` and present its existing output through the validated formatter.
- [x] Modify `src/tools/find_references.ts` with the same contract.
- [x] Modify `src/tools/get_diagnostics.ts` with the same contract.
- [x] Assert file list, outline, source and all mutation input schemas remain unchanged.
- [x] GREEN: run `yarn test test/mcp.integration.test.ts test/diagnostics.test.ts test/symbols.test.ts` and `yarn test:mcp`.

## 3. Preserve structured batch intermediates

- [x] RED: add batch tests rejecting literal `output_format: "toon"` before project/tool work and rejecting a runtime-resolved TOON value before the consuming invocation.
- [x] Modify `src/batch/schema.ts` to reject step-level TOON while preserving batch schema version 1.
- [x] Modify `src/batch/runner.ts` to repeat the guard after template resolution and before `callStructuredTool`.
- [x] Verify explicit/default JSON steps still support `$ref`, `$item`, projection, limits and prepare persistence.
- [x] GREEN: run `yarn test test/batch.test.ts`.

## 4. Final CLI TOON output

- [x] RED: extend CLI smoke for default JSON, `run --output-format toon`, deterministic TOON decode, malformed flag usage and pre-execution rejection of prepare-plus-TOON; cover final-size failure in the pure renderer test.
- [x] Add a pure CLI output renderer module under `src/` so complete-before-write serialization is unit-testable without importing the side-effecting CLI entrypoint.
- [x] Modify `src/cli.ts` to accept `--output-format json|toon` only for `run`, carry renderer selection outside the canonical payload, and keep every error/other command JSON.
- [x] Apply `MAX_BATCH_OUTPUT_BYTES` to the final encoded TOON bytes and perform one stdout write.
- [x] GREEN: run focused tests and `yarn test:cli`; full `yarn test` remains in final verification.

## 5. Measurement

- [x] Add a pinned benchmark-only tokenizer dependency and record its exact tokenizer/model identity.
- [x] Create `scripts/benchmark-formats.mjs` with real/deterministic search, reference, diagnostic, file-list, outline, source and prepare fixtures.
- [x] For every fixture, assert TOON decode deep-equality and report raw JSON/TOON characters, UTF-8 bytes, tokenizer tokens and warmed encode/decode durations.
- [x] Measure serialized current `tools/list` metadata against the retained v0.3.0 character baseline and report static versus dynamic accounting separately.
- [x] Add `benchmark:formats` to `package.json` and document methodology in `benchmark/README.md`.
- [x] Generate and review `benchmark/results/self-formats.json`; require at least 20% tokenizer-estimated savings for full-field broad symbol search.
- [x] Do not publish a provider-billing claim without a separate same-provider usage A/B.

## 6. Documentation and release contract

- [x] Add `docs/adr/0002-toon-at-model-boundary.md` and move its status from Proposed to Accepted after implementation evidence passes.
- [x] Update `README.md` with eligible tools, MCP examples, CLI final-output example, compatibility fallback and non-goals.
- [x] Update `skills/structural-code-editing/SKILL.md` to use TOON only for broad model-facing collection results and never inside batch intermediates or mutation review/apply.
- [x] Update `CHANGELOG.md` and package version for v0.4.0.
- [x] Verify package contents include runtime encoder support, docs and the updated bundled skill.

## 7. Verification and archive

- [x] Run `yarn format:check`.
- [x] Run `yarn lint`.
- [x] Run `yarn typecheck`.
- [x] Run `yarn test`.
- [x] Run `yarn build`.
- [x] Run `yarn test:mcp`.
- [x] Run `yarn test:cli`.
- [x] Run `yarn test:package`.
- [x] Run `yarn audit`.
- [x] Run `yarn benchmark:formats` and verify the checked result and threshold.
- [x] Record requirement-to-test traceability, exact environment, remaining client-format risks and benchmark evidence in `verification.md`.
- [x] Archive the completed change under `openspec/archive/2026-08-03-toon-model-facing-results/` only after every gate passes.
