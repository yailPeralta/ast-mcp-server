# Exploration: Managed Structural Editing Guidance

## Problem

`ast-tool setup` installs the MCP registration and the `structural-code-editing` skill, but it does not make the intended AST-first activation policy persistent in clients that support global instructions. The proposed policy text also names a nonexistent `ast-first` skill and requires AST operations for every code action, including trivial text edits where the distributed skill explicitly recommends normal file tools.

A second gap prevents safe rollout of improved guidance: the installer compares only current bytes. A previously distributed official skill is indistinguishable from a user-customized skill, so setup rejects every official refresh unless the user passes `--force-skill`. `--force-skill` is intentionally broad and can overwrite custom content.

## Current Evidence

### Distributed and installed skill

- The repository distributes `skills/structural-code-editing/SKILL.md` version `4.1.0`, SHA-256 `6284fbeaf054947d20693d317604ceabf5a53d32e3c836855a321e5e26766e29`; the same bytes were published in npm package `0.7.2`.
- Registry metadata and every downloaded tarball were checked against npm `dist.integrity`. Published skill digests are:
  - `0.3.0`: `61251830f0a247d63873fbe6a912187a36ff99489241c24c5b2558563f79ab7f`;
  - `0.4.0`: `b9f75a8cb4900f5c6ad652c106d373ea1e951c8757870b4424a59469dd3b0868`;
  - `0.5.0` and `0.5.1`: `fbc6a9eeb11d3e4ecb5a585283a49b0e4df102b413e7fd82316c2f6e44b2cd56`;
  - `0.6.0`: `622ab59511396f4acf289bad39fb2a03114352f6dc8556f12b37bde98d67a6b3`;
  - `0.7.0`: `e10f89e8834c97fdb68157b7c5d97ebe59311fb8bbcca0f5f26fb47d684cbf52`;
  - `0.7.1`: `672307b01a93a16e395d40b0b58e06cfca34b54ffd05b697ef471633bc476ad1`;
  - `0.7.2`: `6284fbeaf054947d20693d317604ceabf5a53d32e3c836855a321e5e26766e29`.
- Every published digest matches a historical Git blob for `skills/structural-code-editing/SKILL.md`.
- The active Hermes profile contains frontmatter version `4.0.0`, SHA-256 `c25ed470e5c504c38a9be75ffa38f4b6c5a4046548b562e6a33ddba9044fa4d2`, but those bytes match neither a published tarball nor any historical Git blob. It is unknown/custom content and MUST NOT be admitted as an official predecessor.
- `src/services/skill-installer.ts:130-143` classifies any differing destination as conflict unless `force` is true.
- `runAgentSetup` calls the installer after MCP preflight but before client mutation. Skill destination conflicts therefore fail before MCP writes, which must remain true for the combined skill/guidance preflight.

### Verified client instruction surfaces

| Client             | Verified global surface                                                                     | Evidence and constraint                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code        | `${CLAUDE_CONFIG_DIR:-~/.claude}/CLAUDE.md`                                                 | Official memory documentation identifies this as user instructions for all projects. Existing content may be human-owned.                                                                                                                                                                     |
| Hermes             | None for work-policy instructions                                                           | Hermes loads project `.hermes.md`/`AGENTS.md`/`CLAUDE.md`; global `SOUL.md` is personality/identity, not a general work-policy file. The managed policy must remain in the installed skill and must not alter `SOUL.md`.                                                                      |
| OpenCode           | `~/.config/opencode/AGENTS.md`                                                              | Official rules documentation identifies this as global rules. When absent, OpenCode falls back to `~/.claude/CLAUDE.md`; creating the native file can shadow that fallback, so destination resolution must preserve the currently effective human rules. Custom config roots must be honored. |
| Codex CLI          | `${CODEX_HOME:-~/.codex}/AGENTS.md`, unless non-empty `AGENTS.override.md` takes precedence | Official documentation defines the global discovery chain. Writing an ignored `AGENTS.md` while an override is active would create false success.                                                                                                                                             |
| Gemini CLI         | `~/.gemini/GEMINI.md` by default                                                            | Official documentation defines global context and allows `context.fileName` customization in `settings.json`. A configured filename must be resolved or rejected before writes; writing an ignored default is false success.                                                                  |
| GitHub Copilot CLI | No verified user-global file                                                                | Copilot CLI 1.0.79 loads `AGENTS.md` and related files and `copilot init` generates repository `.github/copilot-instructions.md`. No verified user-global instruction path exists. Setup must not invent `~/.copilot/AGENTS.md`; activation remains skill-only.                               |

### Existing orchestration and affected contracts

- `runAgentSetup` has two external call sites: declaration plus `src/cli.ts:369`.
- `installBundledSkill` has call sites in setup and standalone `install-skill`.
- Skill paths are physically deduplicated after canonicalization; four clients share `~/.agents/skills/structural-code-editing/SKILL.md`.
- Setup JSON reports per-agent `mcp` and `skill` plus `physical_writes`. It has no guidance outcome.
- Existing writes are atomic per file but the multi-client operation is convergent, not transactionally atomic.

## Correct Activation Policy

The managed policy must use the real skill name and preserve the skill's cost/correctness boundary:

- load `structural-code-editing` before semantic navigation, impact analysis, or mutation of TypeScript/JavaScript in a compiler project;
- prefer compiler-backed AST tools for symbols, references, impact, diagnostics, and reviewed structural mutations;
- use ordinary file tools for Markdown, configuration, comments, and trivial text edits in already known files;
- if AST tools are unavailable, disclose the fallback and never present textual search as compiler-backed evidence.

This is AST-first where AST semantics matter, not AST-always. Making every `.ts` read an MCP call would add latency and context without improving correctness for known trivial edits.

## Approaches

### 1. Managed blocks plus known-official skill hashes

Package one canonical guidance document and a release manifest of official skill digests. Resolve each selected client's effective global instruction file, append or update one marker-delimited managed block while preserving all unrelated bytes, and auto-upgrade a skill only when its digest is current or listed as a known official predecessor.

Pros:

- preserves human instructions and custom skills;
- provides deterministic idempotency and safe official upgrades;
- prevents false success on shadowed/ignored instruction files;
- keeps unsupported Hermes/Copilot behavior honest and skill-only;
- can share physical writes when effective paths alias.

Cons:

- requires client-specific guidance destination resolution;
- marker corruption and concurrent edits must fail closed;
- historical release hashes become a maintained package artifact.

### 2. Replace entire global instruction files

Write one canonical file at each documented default path.

Pros: small implementation.

Cons: overwrites user policy, shadows OpenCode/Codex precedence, ignores Gemini customization, and cannot coexist with human instructions. Rejected.

### 3. Skill-only activation for every client

Improve the skill description but do not persist global guidance.

Pros: no instruction-file mutation.

Cons: clients may not activate the skill before initial code exploration, which is the behavior the request intends to fix. It also leaves no persistent, inspectable activation contract on clients with supported global instructions. Rejected as incomplete.

## Recommendation

Choose managed blocks plus known-official hashes.

Create a pure planner that resolves skill destinations and effective guidance destinations, classifies all artifacts, and snapshots every target before any write. Apply only after all MCP registrations and asset plans preflight successfully. Preserve unrelated instruction bytes, BOM, newline style, and mode; reject malformed/duplicate markers, non-regular destinations, unknown custom context routing, and concurrent changes.

Do not modify Hermes `SOUL.md` or create a Copilot user-global file. Report those clients as `skill_only`, not as globally configured.

## Scope

In scope:

- improve the distributed skill activation contract and increment its version;
- package a canonical managed-guidance payload and registry-proven official-release digest manifest;
- safely update only registry-proven official predecessor skills without `--force-skill`;
- add managed global guidance for Claude, OpenCode, Codex, and Gemini;
- preserve client-specific precedence/custom roots and physically deduplicate aliases;
- extend setup/install reporting, tests, fixtures, package smoke, docs, and rollback evidence.

Out of scope:

- repository instruction files, including `.github/copilot-instructions.md`;
- Hermes `SOUL.md` or persona changes;
- inventing unsupported Copilot global paths;
- overwriting unknown/custom skills without explicit force;
- transactional rollback across independent files/client CLIs;
- changing MCP tool behavior or registration contracts.

## Risks

- A native OpenCode global file can shadow Claude fallback rules. Resolve the effective existing path instead of blindly creating the native path.
- Codex `AGENTS.override.md` can shadow `AGENTS.md`. Update the effective non-empty global source.
- Gemini custom `context.fileName` can make `GEMINI.md` ineffective. Parse supported settings or fail closed.
- Marker collisions or malformed blocks can corrupt human policy. Require exactly zero or one well-formed owned block.
- A digest allowlist can become stale. Package explicit version/digest entries and require the source digest to equal the current manifest entry.
- Asset writes are not globally transactional. Snapshot-check every file, write atomically, report partial completion, and make retry convergent.

## Ready for Proposal

Yes. The client matrix, unsupported surfaces, policy wording, ownership model, official-upgrade boundary, and safety invariants are resolved.
