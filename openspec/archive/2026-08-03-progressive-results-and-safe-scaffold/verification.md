# Verification

Verified on 2026-08-04 against Node.js v24.16.0 and Yarn 4.15.0.

## Requirement traceability

| Requirements | Evidence |
| --- | --- |
| `AST-VERSION-001`, `AST-VERSION-002` | `src/server.ts` reads shipped package metadata; in-memory assertions in `test/mcp.integration.test.ts`; source stdio assertion in `scripts/mcp-smoke.mjs`; installed-tarball stdio assertion in `scripts/package-smoke.mjs` proves package and handshake version `0.5.0`. |
| `AST-SEARCH-001` through `AST-SEARCH-003` | Rank classification and deterministic ordering in `test/symbols.test.ts`; default page and explicit pagination in `test/mcp.integration.test.ts` and `test/batch.test.ts`. |
| `AST-SEARCH-004` through `AST-SEARCH-006` | Closed `selectors`, `summary` and `full` records, exact downstream selectors, stable metadata and JSON/decoded-TOON equality in `test/mcp.integration.test.ts`, `test/batch.test.ts` and `scripts/benchmark-result-shapes.mjs`. |
| `AST-REF-001` through `AST-REF-003` | Default location-only and opt-in context records, complete scope metadata, pagination and JSON/decoded-TOON equality in `test/mcp.integration.test.ts` and the multi-file reference benchmark fixture. |
| `AST-DIAG-001` | Existing diagnostic fields/messages and TOON round trip remain covered by `test/result-format.test.ts` and `test/mcp.integration.test.ts`; no diagnostic projection was added. |
| `AST-MEASURE-101` through `AST-MEASURE-104` | `scripts/benchmark-result-shapes.mjs` and `benchmark/results/self-result-shapes.json`: exact-name, exact-path, prefix, broad-substring and multi-file-reference corpus; declared evidence preserved; six logical calls in both profiles; 3,910 to 1,220 TOON tokens (`68.80%`, gate `>=35%`). |
| `AST-MEASURE-105` | Complete eleven-tool metadata is 22,473 characters versus retained v0.4.0 metadata at 16,650 (`+5,823`). The scaffold marginal contribution is 5,411 characters and 1,295 local tokens. No historical v0.4.0 token count is fabricated. |
| `AST-MEASURE-106` | `README.md`, `benchmark/README.md` and ADR 0003 label token counts as local `o200k_base` serializer estimates and make no billing, cache or provider-usage claim. |
| `AST-SCAFFOLD-001` through `AST-SCAFFOLD-004` | Strict bounded MCP schema and declaration-fragment validation in `test/scaffold.test.ts`; prepare-only behavior, absent target, existing empty target, symlink parent and diagnostic policy in `test/operations.test.ts` and `test/mcp.integration.test.ts`. |
| `AST-SCAFFOLD-005` through `AST-SCAFFOLD-008` | Single exported class, deterministic loud placeholders, body-free outline, direct pending method paths, diagnostics and `/dev/null` preview assertions in `test/scaffold.test.ts`, `test/operations.test.ts` and `test/mcp.integration.test.ts`. |
| `AST-CREATE-001` through `AST-CREATE-003` | Explicit absent-file hash/state and post-workspace fingerprint in `src/services/operations.ts`; empty-file distinction, target-appearance conflict and atomic link-based no-clobber apply in `test/operations.test.ts`. |
| `AST-CREATE-004`, `AST-CREATE-005` | Exact-postimage rollback deletion, competing-writer preservation, durable-postimage recovery and idempotent receipt replay in `test/operations.test.ts`. |
| `AST-CREATE-006`, `AST-CREATE-007` | `/dev/null` preview before apply and persisted-plan replay in `test/operations.test.ts` and `test/operation-plan-file.test.ts`; existing rename/body replacement compatibility remains in the full suite and CLI smoke. |
| `AST-BATCH-SCAFFOLD-001`, `AST-BATCH-SCAFFOLD-002` | Final-step prepare restrictions in `test/batch.test.ts`; persisted scaffold creation/replay across cleared operation stores in `test/operation-plan-file.test.ts` and `scripts/cli-smoke.mjs`. |
| `AST-DOC-101`, `AST-DOC-102` | `README.md`, `CHANGELOG.md`, ADRs 0003/0004 and bundled `skills/structural-code-editing/SKILL.md` version 4.0.0 document progressive defaults, compatibility modes and scaffold review/apply/body-replacement flow. |

## Commands and observed results

- `yarn format` and `yarn format:check`: passed; all matched files use Prettier style.
- `yarn lint`: passed with zero findings.
- `yarn typecheck`: passed for source and test TypeScript configs.
- `yarn test`: passed, 16 files and 90 tests.
- `yarn build`: passed.
- `yarn test:mcp`: passed over stdio with 11 tools and decoded TOON output; source handshake equals package `0.5.0`.
- `yarn test:cli`: passed, including read composition, TOON, persisted apply/replay, lock contention, skill installation and agent setup.
- `yarn test:package`: passed from an isolated tarball install with lifecycle scripts disabled, package/handshake version `0.5.0`, global executable support and idempotent setup for both agent targets.
- `yarn benchmark:formats`: passed all round-trip and format-reduction gates; eligible aggregate 9,785 to 7,254 tokens (`25.87%`).
- `yarn benchmark:shapes`: passed twice with stable 3,910 to 1,220 aggregate TOON tokens (`68.80%`), complete evidence and unchanged six-call bound.
- `yarn benchmark:batch`: passed; two model round-trips became one and serialized context fell from 7,818 to 417 characters (`94.67%`). Local duration/RSS movement is treated as noise.
- `yarn audit`: passed with no audit suggestions.
- `yarn pack --dry-run`: includes runtime metadata, server/CLI distribution, scaffold implementation, README, changelog and bundled skill.
- `git diff --check`: passed.

## Release decision

The local v0.5.0 release gates pass. Node 20.19 and Node 22 compatibility remain represented by the repository CI matrix; this verification run used Node 24.16.0 and does not claim those CI jobs were executed locally.

Progressive shaping and TOON savings are model-facing serializer estimates. The scaffold adds substantial static schema metadata, reported separately above. No provider-billed-token, cache-saving or latency claim is made.
