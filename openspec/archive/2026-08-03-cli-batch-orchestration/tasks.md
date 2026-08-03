# Tasks: Batch CLI orchestration

## 1. Contract and harness

- [x] Add batch schemas, limits and static validation tests.
- [x] Add in-process MCP adapter and structured-result normalization.
- [x] Verify existing MCP suite remains green.

## 2. Pipeline engine

- [x] RED: invalid/forward refs, duplicate ids and forbidden tools fail.
- [x] Implement ordered steps and project-root injection.
- [x] Implement recursive `$ref` resolution.
- [x] Implement bounded `foreach`, `$item`, order preservation and read concurrency.
- [x] Implement `emit` projection and final-output limit.
- [x] GREEN: unit/integration pipeline tests pass.

## 3. Persisted plans

- [x] Define versioned plan envelope and size/permission limits.
- [x] Export/import operation records without exposing mutable internals.
- [x] Atomically persist prepared plans.
- [x] Validate hash, byte integrity, containment, expiry and status on load.
- [x] Persist applied receipts and test replay.
- [x] RED/GREEN: wrong hash, corrupt, expired, stale and cross-process tests.

## 4. CLI

- [x] Add `ast-tool run`, `validate` and `apply` with deterministic exit codes.
- [x] Accept file and stdin documents.
- [x] Keep stdout JSON-only and errors/logging on stderr.
- [x] Add package bin and CLI smoke tests.

## 5. Productization

- [x] Document Claude Code Bash, Hermes, schemas, examples, limits and write boundary.
- [x] Update bundled skill.
- [x] Add separate-vs-batch benchmark and checked result.
- [x] Extend CI/package smoke.

## 6. Verification and archive

- [x] Run clean install, format, lint, typecheck, tests, build, MCP smoke, CLI smoke, audit and pack dry-run.
- [x] Map every AST-BATCH/PLAN/CLI requirement to implementation and assertions.
- [x] Record remaining risks and archive the SDD.
