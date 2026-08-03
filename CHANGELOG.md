# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.3.0]: https://github.com/yailPeralta/ast-mcp-server/releases/tag/v0.3.0
