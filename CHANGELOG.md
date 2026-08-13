# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.2] — release candidate (unreleased, 2026-08-12)

### Fixed

- Promotion preflight now validates raw npm registry metadata exactly once, compares live integrity with the verified artifact before and after mutation, and classifies the normalized readback without reinterpreting its field schema.
- Added a composed regression covering eligible, already-promoted, and integrity-drift promotion readbacks.

## [0.7.1] — published to `next`, verified, not promoted (2026-08-12)

### Fixed

- Public-registry verification now creates physical fake Claude Code and Hermes executables, preserving each agent identity after executable canonicalization.
- Added a regression through the real agent detector so future consumer smokes cannot reintroduce identity-collapsing symlinks.

### Release status

- The package was published under the `next` dist-tag with valid npm provenance and passed its exact-SHA public-consumer verification. Promotion was rejected before mutation because the preflight passed a normalized registry record back into the raw-record validator. It was never promoted to `latest`, tagged, or released on GitHub; `0.7.2` supersedes it.

## [0.7.0] — published to `next`, not promoted (2026-08-12)

### Added

- Compiler-backed, freshness-aware impact traversal with bounded direct/transitive relationships and fail-closed test-candidate evidence.
- Opt-in SQLite symbol-index canary with corruption/write-failure fallback, restart reuse, explicit recovery, and bounded project-status observability; default and reserved `enabled` policies remain memory-only.
- Bounded per-project scheduling, cancellation/deadline semantics, idempotent graceful shutdown, and a closed public-error envelope with correlation IDs.
- Deterministic Linux x64 production-readiness evidence across Node.js 22.5.0 and Node.js 24 for this repository and `x-scraper`.
- Exact-SHA staged release workflows for `next` publication, public-registry verification, and separately authorized `latest` promotion.

### Changed

- Symbol search and impact discovery now remain compiler-authoritative while applying deterministic limits before globally materializing expensive relationships.
- The supported release target is explicitly Linux x64 with the required GNU coreutils publication primitive; other platforms and architectures remain unverified.
- The package now ships its support and security policies alongside the README, changelog, binaries, and bundled structural-editing skill.

### Security

- Release preparation, GitHub authorization, OIDC publication, and npm-token promotion use physically separated least-authority phases with lifecycle scripts disabled.
- Workflow actions, permissions, inputs, conditions, commands, environments, and credential placement are checked against a closed immutable policy.
- Package publication binds exact tarball bytes and packed `gitHead` to the authorized SHA; consumer verification independently proves preview/apply/replay postimages and no-write failure paths.
- Public MCP and stderr errors are bounded and sanitized against source, path, stack, environment, and credential disclosure.

### Release status

- The package was published under the `next` dist-tag with valid npm provenance, but its deterministic public-consumer verification failed because the verifier canonicalized both fake agent symlinks to one fixture identity. The package was never promoted to `latest`, tagged, or released on GitHub; `0.7.1` supersedes it.

## [0.6.0] - 2026-08-05

### Added

- Read-only `ast_get_file` with bounded exact source lines, SHA-256 byte hashes, compiler snapshot state, and `symbols_only` body-free output.
- `ast_get_file` now also returns bounded project freshness metadata, distinguishing fresh, pending, stale, rebuilding, and degraded session state from the file-level snapshot state.
- Project-scoped file snapshot validation with UTF-8 checks, traversal rejection, symlink containment checks, and ambiguous-path failures.
- Read-only `ast_explore` with query/file/symbol routing, progressive source and compiler-reference evidence, freshness/completeness metadata, unresolved selectors, and serialized byte budgets.
- Public trust guidance for compiler, syntax, heuristic and derived-index evidence, including the fail-closed rules for stale/degraded reads and compiler-backed test candidates.
- A deterministic context workflow benchmark comparing full-file, primitive, and composed exploration workflows.

## [0.5.1] - 2026-08-05

### Added

- Bounded JSON-safe project status contracts and the read-only `ast_get_project_status` tool.
- Session freshness metadata with separate source, config, and canonical fingerprints.
- Serialized operation-queue accounting and status integration without changing reviewed mutation semantics.

### Changed

- Source synchronization verifies stability across refresh, snapshot, refresh, and verification before reporting fresh state.
- Phase 1 keeps the symbol index disabled while exposing explicit stale/degraded recovery state.
- Documentation now distinguishes file snapshot freshness from project freshness, reports bounded read budgets/truncation, and defines the prepare-review-apply mutation boundary.

### Security

- Status projections redact identities, absolute paths, credentials, and multi-token `Authorization` values at both transition and projection boundaries.
- Noncanonical external fingerprints are converted to bounded opaque SHA-256 digests before projection.

## [0.5.0] - 2026-08-03

### Added

- Relevance-ranked symbol search with `selectors`, `summary`, and backward-compatible `full` detail profiles.
- Progressive semantic references with location-only defaults and opt-in bounded source context.
- `ast_scaffold_class`, a strict prepare-only class scaffold that generates explicit throwing method placeholders and uses the existing preview/apply protocol.
- Hash-bound absent-file plans with atomic no-clobber creation, conservative rollback, persisted replay, and idempotent receipt recovery.
- A checked result-shaping workflow benchmark covering ranking, selector chaining, multi-file references, JSON/TOON payloads, call counts, evidence preservation, and complete tool metadata.

### Changed

- Symbol search now defaults to ranked `summary` records with a 20-result page. Use `detail: "full", limit: 100` for the v0.4.0 result profile.
- Reference search now defaults to `locations` without source lines. Use `detail: "context"` for the v0.4.0 record profile.
- MCP and batch client identity now derives from the shipped package version instead of a separately maintained literal.

### Security

- Scaffold inputs are strict and bounded; identifiers, duplicates, raw TypeScript fragments, paths, parent directories, and target absence are validated before plan creation.
- File creation uses same-directory exclusive staging plus an atomic hard-link commit and never falls back to overwrite-capable rename.
- Existing rename/body-replacement plan hashes and persisted modification plans remain compatible.

## [0.4.0] - 2026-08-03

### Added

- Opt-in TOON envelopes for symbol search, semantic references, and diagnostics through `output_format: "toon"`.
- Plain TOON output for final read-only batch results through `ast-tool run --output-format toon`.
- Reproducible JSON/TOON benchmark with lossless round trips, UTF-8 bytes, `o200k_base` token estimates, encoding latency, static tool-metadata accounting, and negative controls.

### Changed

- Collection-heavy tools validate their canonical Zod outputs explicitly before returning JSON or TOON. They no longer advertise one MCP `outputSchema` because their structured result can be either the canonical object or a TOON envelope.
- The bundled structural-code-editing skill now selects TOON only for measured collection shapes and keeps JSON for source, outline, file-list, and mutation workflows.

### Security

- Batch steps reject statically declared and dynamically resolved TOON intermediates before the affected invocation.
- TOON output is capped at 10 MiB after UTF-8 encoding, and mutation preparation remains JSON-only so review coordinates are never compacted.
- Successful MCP TOON output is decode-checked against the validated value, and MCP error text is capped at 64 KiB of UTF-8.
- The transitive Hono runtime is resolved to `4.12.34`, closing GHSA-8j4g-w8fx-2239 from the MCP SDK dependency tree.

## [0.3.0] - 2026-08-03

Initial public release.

### Added

- Bounded structural reads for project files, symbols, outlines, references, exact declaration source, and TypeScript diagnostics.
- Hash-bound `prepare → review → apply` operations for project-wide symbol renames and body replacements.
- Persistent CLI plans with workspace/config fingerprints, cooperative locks, exact postimages, conservative rollback, and idempotent receipts.
- Declarative batch CLI with bounded fan-out, deterministic aggregation, compact `emit`, and persisted prepare plans.
- Bundled `structural-code-editing` skill for Claude Code and Hermes.
- Interactive and non-interactive agent setup that detects clients, installs the skill, registers the MCP server, verifies its tools, and replays safely.
- Yarn 4 package workflow with dependency lifecycle scripts disabled and isolated installed-tarball smokes.

### Security

- New TypeScript diagnostics fail a prepared mutation closed unless explicitly reviewed with `allow_new_errors`.
- Apply rejects stale workspaces, changed configs/sources, mismatched plan hashes, unsafe plan files, conflicting MCP registrations, and conflicting skill content.
- Inputs, outputs, operation stores, subprocesses, batch fan-out, plan lifetime, and filesystem access are bounded.

[0.6.0]: https://github.com/yailPeralta/ast-mcp-server/releases/tag/v0.6.0
[0.5.1]: https://github.com/yailPeralta/ast-mcp-server/releases/tag/v0.5.1
[0.5.0]: https://github.com/yailPeralta/ast-mcp-server/releases/tag/v0.5.0
[0.4.0]: https://github.com/yailPeralta/ast-mcp-server/releases/tag/v0.4.0
[0.3.0]: https://github.com/yailPeralta/ast-mcp-server/releases/tag/v0.3.0
