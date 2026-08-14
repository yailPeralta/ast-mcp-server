# Proposal: Managed Structural Editing Guidance

## Intent

Make `ast-tool setup` safely install both the structural editing skill and the persistent activation guidance needed for supported agents to use the AST MCP when compiler semantics matter. Keep user-authored instructions and customized skills intact, report unsupported global surfaces honestly, and allow automatic refresh only from known official skill releases.

## Scope

### In Scope

- Update the distributed `structural-code-editing` skill so its activation contract is explicit, cost-aware, and uses the real skill name.
- Package a canonical marker-delimited guidance payload and a manifest of the current candidate plus registry-proven official skill digests.
- Auto-upgrade a destination only when its bytes match a known official predecessor; retain explicit force for unknown/custom content.
- Install managed global guidance for Claude Code, OpenCode, Codex CLI, and Gemini CLI at each client's effective supported path.
- Treat Hermes and Copilot CLI as `skill_only`: install/update the skill but do not mutate `SOUL.md` or invent a user-global Copilot file.
- Preserve all unrelated instruction bytes, mode, BOM, newline convention, client routing/precedence, physical-path deduplication, preflight-before-write, bounded diagnostics, JSON reporting, idempotency, and convergent retry.
- Validate source-tree, built package, and real installed-client discovery in isolated homes.

### Out of Scope

- Repository-level instruction files, including `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md` inside projects.
- Changes to Hermes identity/persona, Copilot repositories, MCP tool behavior, or the six-client registration adapters.
- Blind overwrite of user-authored skills/instructions or generalized management of arbitrary blocks.
- Cross-file transactional rollback.

## Capabilities

### New Capability

- `managed-structural-guidance`: safe official skill upgrades, effective global instruction routing, managed-block lifecycle, reporting, and verification.

### Modified Capability

- `setup-agent-support`: setup preflights and installs managed assets in addition to MCP registration and skill placement.

## Approach

Introduce a package-owned asset manifest and a pure managed-guidance planner. The planner resolves effective client paths, groups aliases by canonical physical identity, classifies current bytes and markers, and records snapshots. Setup preflights MCP plus all skill/guidance assets before any mutation. Apply authenticates parent/preimage/destination inodes, keeps each staged inode descriptor-bound through no-clobber creation or atomic exchange, validates both sides of replacement commits, and reauthenticates exact postimages before later asset or MCP mutations.

The official skill upgrade boundary is digest-based, not version-string based: matching the current digest is unchanged; matching a listed predecessor is a safe managed update; any other digest conflicts unless explicit force is supplied. This prevents a customized file that retained an old `version:` field from being silently replaced.

## User-Visible Behavior

- Fresh setup reports `guidance: installed` for supported global surfaces and `guidance: skill_only` for Hermes/Copilot.
- Replay reports `guidance: unchanged` and performs no physical writes.
- A registry-proven official previous skill reports `skill: updated` without requiring `--force-skill`.
- Unknown content remains a conflict even if its frontmatter claims an official version; the currently installed Hermes `4.0.0` copy is one such unknown and requires explicit review/force.
- Unknown/custom skill bytes still fail closed and name the explicit force flag.
- Human instruction content outside the owned block is byte-preserved.
- Shadowed or unresolvable instruction routing fails before writes instead of reporting false success.

## Affected Areas

| Area                                                 | Impact          | Description                                                         |
| ---------------------------------------------------- | --------------- | ------------------------------------------------------------------- |
| `skills/structural-code-editing/**`, packaged assets | Modified/Create | Activation contract, canonical guidance, official digest manifest   |
| `src/services/skill-installer.ts`                    | Modified        | Known-official upgrade classification and snapshot-safe plans       |
| `src/services/managed-guidance.ts`                   | Create          | Client routing, marker planning, atomic application, verification   |
| `src/services/agent-setup.ts`, `src/cli.ts`          | Modified        | Combined preflight/apply and stable result schema                   |
| `test/**`, `scripts/**`                              | Modified/Create | RED contracts, isolated homes, real-client discovery, package smoke |
| `README.md`, `CHANGELOG.md`, setup ADR               | Modified        | Policy, paths, unsupported surfaces, force/rollback semantics       |

## Risks and Mitigations

| Risk                                   | Mitigation                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Human instructions overwritten         | Modify only one exact owned block; preserve all other bytes and metadata                            |
| OpenCode fallback shadowed             | Resolve the effective existing global source and preserve its content when creating native rules    |
| Codex/Gemini custom precedence ignored | Resolve effective configured path or fail closed before writes                                      |
| Customized skill mistaken for official | Require exact SHA-256 match against packaged manifest                                               |
| Concurrent file mutation               | Bind parent/preimage/staged/destination inodes; atomic exchange with exact-pair validation/rollback |
| Partial multi-file completion          | Separate committed, possibly committed, rollback-success, rollback-failure, and pending operations  |
| Unsupported client path invented       | Explicit `skill_only` outcome for Hermes and Copilot                                                |

## Rollback

Revert the setup/planner/assets code together. Previously inserted owned blocks may remain because they are valid plain-text guidance and do not affect MCP transport. A future explicit removal command can be designed separately; rollback MUST NOT delete blocks or skill files automatically. Validate the prior CLI against the resulting MCP registrations and skills before release rollback.

## Success Criteria

- [x] The distributed policy names `structural-code-editing`, uses AST only where semantics matter, and defines explicit fallback behavior.
- [x] Known official predecessor skills update automatically; customized variants do not.
- [x] Claude/OpenCode/Codex/Gemini receive one effective managed block without losing human content.
- [x] Hermes/Copilot are reported as `skill_only` with no unsupported file mutation.
- [ ] All selected destinations preflight before the first write; races and malformed markers fail closed on the repaired exact tree.
- [x] Replay makes zero physical writes and package/real-client isolated-home smokes prove effective discovery.
