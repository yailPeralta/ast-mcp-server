# Managed Structural Guidance Specification

## Requirements

### Requirement MSG-001: Canonical activation policy

The package MUST distribute one canonical `structural-code-editing` activation policy. It MUST require loading the skill before semantic TypeScript/JavaScript navigation, impact analysis, diagnostics, or structural mutation in compiler projects. It MUST prefer ordinary file tools for Markdown, configuration, comments, and trivial known-file text edits. When AST tools are unavailable, the agent MUST disclose the fallback and MUST NOT describe textual evidence as compiler-backed.

#### Scenario MSG-001-A: Semantic code task

- GIVEN a TypeScript project and available AST tools
- WHEN an agent must locate a symbol, evaluate references, or perform a structural mutation
- THEN the policy directs it to load `structural-code-editing` and follow its compiler-backed protocol first

#### Scenario MSG-001-B: Trivial text task

- GIVEN an already known Markdown, config, comment, or trivial text edit
- WHEN no compiler semantics are needed
- THEN the policy permits ordinary file tools without an AST round trip

#### Scenario MSG-001-C: MCP unavailable

- GIVEN the skill is present but AST tools are unavailable
- WHEN work must continue
- THEN the agent declares the fallback and does not claim textual search is structural evidence

### Requirement MSG-002: Official skill release manifest

The package MUST ship a versioned manifest containing the current candidate skill SHA-256 and every admitted registry-proven official predecessor SHA-256. Each predecessor entry MUST identify the npm package version(s) whose downloaded tarball supplied the bytes, and admission evidence MUST include successful npm `dist.integrity` verification. The source skill bytes used by setup MUST match the manifest's current digest. A destination matching the current digest MUST be `unchanged`; a destination matching an admitted predecessor MUST be `updated`; any other differing digest MUST conflict unless explicit force is supplied.

The installer MUST classify by exact bytes/digest, not frontmatter version alone. It MUST reject a malformed manifest, duplicate digest, unknown algorithm, source mismatch, non-regular destination, or unreadable destination before any write.

#### Scenario MSG-002-A: Official predecessor

- GIVEN an installed skill whose digest is an admitted official predecessor
- WHEN setup runs without force
- THEN it updates to the packaged current bytes and reports `updated`

#### Scenario MSG-002-B: Customized predecessor label

- GIVEN a locally modified skill that retains an old official `version:` field but has a different digest
- WHEN setup runs without force
- THEN it fails closed and leaves every selected destination unchanged

#### Scenario MSG-002-C: Unproven installed copy

- GIVEN an installed skill whose frontmatter says `4.0.0` but whose digest is `c25ed470e5c504c38a9be75ffa38f4b6c5a4046548b562e6a33ddba9044fa4d2`
- AND that digest exists in neither verified npm tarballs nor historical Git blobs
- WHEN setup runs without force
- THEN it treats the skill as unknown/custom and fails closed

#### Scenario MSG-002-D: Source/manifest mismatch

- GIVEN packaged skill bytes do not match the manifest current digest
- WHEN setup preflights
- THEN it fails before any MCP, skill, or guidance write

### Requirement MSG-003: Effective global guidance routing

Setup MUST resolve the effective supported user-global instruction surface for each selected client:

- Claude Code: `${CLAUDE_CONFIG_DIR:-~/.claude}/CLAUDE.md`.
- OpenCode: honor custom config roots; use native global `AGENTS.md` when effective, while preserving any active Claude fallback content that native creation would shadow.
- Codex CLI: `${CODEX_HOME:-~/.codex}/AGENTS.override.md` when it is the active non-empty global source; otherwise `${CODEX_HOME:-~/.codex}/AGENTS.md`.
- Gemini CLI: the global context filename(s) configured in supported `settings.json`, otherwise `~/.gemini/GEMINI.md`; ambiguous/unsupported routing MUST fail closed.
- Hermes and Copilot CLI: no user-global instruction write; report `skill_only`.

Setup MUST NOT modify Hermes `SOUL.md`, repository instruction files, or an invented Copilot global path.

#### Scenario MSG-003-A: OpenCode Claude fallback

- GIVEN OpenCode has no native global rules and uses an existing Claude global file as fallback
- WHEN managed OpenCode guidance is installed
- THEN the effective human fallback content remains present and the managed block becomes effective

#### Scenario MSG-003-B: Codex override

- GIVEN a non-empty `AGENTS.override.md`
- WHEN setup runs for Codex
- THEN the managed block is planned in the override rather than an ignored `AGENTS.md`

#### Scenario MSG-003-C: Unsupported global surface

- GIVEN Hermes or Copilot is selected
- WHEN setup succeeds
- THEN its skill is installed and guidance reports `skill_only` with no instruction-file write

### Requirement MSG-004: Owned managed block

The canonical policy MUST be embedded between exact, versioned ownership markers. A destination with no block MAY receive one appended block. A destination with exactly one well-formed owned block MAY have that block updated. Duplicate, nested, reversed, partial, or unknown-version owned markers MUST conflict before writes.

All bytes outside the owned block MUST be preserved exactly. New files MUST use UTF-8 and a terminal newline. Existing UTF-8 BOM, newline convention, and file mode MUST be preserved. Symlinks, directories, devices, and non-UTF-8 files MUST fail closed.

#### Scenario MSG-004-A: Existing human policy

- GIVEN a UTF-8 instruction file with human-authored content and no owned block
- WHEN setup applies guidance
- THEN all original bytes remain and exactly one owned block is appended

#### Scenario MSG-004-B: Managed block refresh

- GIVEN one valid older owned block surrounded by human content
- WHEN the canonical policy changes
- THEN only the owned block changes and replay is byte-identical

#### Scenario MSG-004-C: Malformed markers

- GIVEN duplicate or partial ownership markers
- WHEN preflight runs
- THEN setup fails and no selected asset or MCP registration changes

### Requirement MSG-005: Global preflight, concurrency, and apply

Setup MUST preflight MCP inspections, source artifacts, every physically deduplicated skill destination, and every guidance destination before the first write. Plans MUST record canonical path identity, authenticated existing-ancestor and destination identity, preimage existence/type/mode/digest, and exact postimage digest. Before each write, setup MUST revalidate every plan including `unchanged`. The staged and existing preimage inodes MUST remain bound to open descriptors through publication. New files MUST use descriptor-bound no-clobber creation. Replacements MUST use a same-directory atomic exchange that is accepted only when the destination received the held staged inode, the temporary name received the pinned preimage inode, and the pinned preimage still has its planned digest and mode. An unexpected but provable pair or a same-inode preimage edit MUST be exchanged back only after revalidating that exact pair; an unprovable or failed rollback MUST be reported as possibly committed. Mutation MUST stay relative to authenticated directory identities, and every completed/unchanged postimage MUST be reauthenticated before a later managed-asset or MCP mutation and before success reporting.

A concurrent change MUST stop further writes and produce a bounded partial result that distinguishes proved committed, possibly committed, successfully rolled-back, rollback-failed, and genuinely pending operations. A successfully rolled-back operation MUST remain pending for retry. Retry MUST inspect uncertain state and replan from current bytes without rewriting completed current assets. The product MUST NOT claim cross-file transactional atomicity.

The supported Linux implementation MUST fail closed when GNU coreutils 9.7 `mv --exchange --no-copy -T`, GNU coreutils `ln -L -T`, `/proc/self/fd`, `O_DIRECTORY`, or `O_NOFOLLOW` is unavailable; other platform primitives remain unverified rather than silently falling back to pathname-only mutation.

#### Scenario MSG-005-A: Cross-target conflict

- GIVEN one selected skill or guidance destination conflicts
- WHEN setup preflights
- THEN no MCP, skill, or guidance destination is modified

#### Scenario MSG-005-B: Race after preflight

- GIVEN a destination changes after planning
- WHEN apply reaches that destination
- THEN setup does not overwrite it, rolls back only a proved exchange pair, reports committed/possibly-committed/rollback-success/rollback-failure/pending outcomes honestly, and stops

#### Scenario MSG-005-B2: Same-inode race after final validation

- GIVEN another writer changes the destination bytes or mode in place after final validation without replacing its inode
- WHEN replacement exchanges the staged and destination entries
- THEN setup detects the pinned preimage mismatch before cleanup, restores the exact pair when still provable, reports the operation rolled back and pending, and preserves the concurrent bytes or mode

#### Scenario MSG-005-C: Alias deduplication

- GIVEN multiple logical clients resolve to one physical path
- WHEN setup applies assets
- THEN that path is classified and written once but reported for every logical client

### Requirement MSG-006: Stable reporting and standalone install

Setup success JSON MUST use a new explicit schema version and report ordered per-agent `mcp`, `skill`, and `guidance` outcomes plus physically deduplicated writes. Guidance status MUST be one of `installed`, `updated`, `unchanged`, or `skill_only`. Failures MUST retain bounded diagnostics and separate `completed_writes`, `possibly_committed`, `rolled_back`, `rollback_failed`, and `pending` operations without raw instruction contents, environment values, or provider output.

`ast-tool install-skill` MUST use the same official-release manifest and safe-upgrade rules. It MUST NOT install global guidance; global guidance remains part of `ast-tool setup` because it depends on selected agent routing and combined preflight.

#### Scenario MSG-006-A: First setup and replay

- GIVEN fresh supported homes
- WHEN setup runs twice
- THEN the first result reports installed assets, the second reports unchanged/skill_only, and the second has zero physical writes

#### Scenario MSG-006-B: Standalone skill update

- GIVEN a known official predecessor skill
- WHEN `install-skill` runs
- THEN it safely updates the skill but creates no global instruction file

### Requirement MSG-007: Package and real-client verification

The source tree and npm tarball MUST contain the current skill, canonical guidance payload, and release manifest. Tests MUST exercise isolated homes/config roots for all six clients, path aliases, spaces, precedence, custom settings, malformed markers, races, official/custom skill variants, idempotency, and partial retry.

Real installed-client smoke MUST verify effective discovery for every locally available supported global surface without modifying the user's real home. A client whose global surface cannot be proven MUST remain `skill_only` or fail closed; test fixtures MUST NOT promote assumptions into support.

#### Scenario MSG-007-A: Packaged consumer

- GIVEN a clean consumer installing the packed tarball
- WHEN it runs setup against fake agents and isolated homes
- THEN packaged assets resolve, apply, and replay idempotently

#### Scenario MSG-007-B: Installed clients

- GIVEN locally installed Claude/OpenCode/Codex/Gemini clients
- WHEN smoke runs in isolated homes
- THEN each client reports or demonstrates that the managed policy is in its effective instruction chain
