# Design: Managed Structural Editing Guidance

## Technical Approach

Keep `agent-setup.ts` as the effect orchestrator. Add two asset planners beneath it:

1. `skill-installer.ts` plans physically deduplicated skill writes using a packaged official-release manifest.
2. `managed-guidance.ts` resolves each client's effective global instruction surface and plans one marker-owned block while preserving all unrelated bytes.

Both planners return immutable preimage/postimage plans. Setup performs all MCP and asset classification first, then applies the planned asset writes through authenticated Linux directory descriptors before sequential MCP mutation/verification. Parent, preimage, held temporary, destination, and completed-postimage identities are reauthenticated throughout the transition. Creation hard-links from the held temporary descriptor without clobber; replacement uses GNU `mv --exchange --no-copy -T`, validates both sides of the exchange, rereads the pinned preimage handle to verify its planned digest and mode, and rolls the revalidated exact pair back when an in-call destination substitution or same-inode edit is detected. This retains the fail-closed preflight boundary and convergent retry model without pretending pathname checks eliminate TOCTOU races.

## Architecture Decisions

| Question                                                  | Alternatives                                                                | Decision and rationale                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How should old official skills update?                    | Version field; overwrite any difference; exact release digest               | Exact SHA-256 release manifest. Version fields are user-editable and cannot prove provenance; blind overwrite violates customization safety.                                                                                                                                                                                                            |
| How should global instructions coexist with user content? | Replace file; external include; marker-owned block                          | Marker-owned block. Includes are not portable across clients and replacement destroys human policy.                                                                                                                                                                                                                                                     |
| Which clients receive global files?                       | Same AGENTS path for six; only verified effective surfaces                  | Only Claude/OpenCode/Codex/Gemini. Hermes policy remains skill-based; Copilot has no verified user-global path.                                                                                                                                                                                                                                         |
| How should OpenCode fallback be handled?                  | Always create native file; edit Claude fallback; merge fallback into native | Resolve effective state. If native exists, manage it. If only Claude fallback exists and is also a selected Claude target, one physical managed block can serve both. If native creation is needed, seed it with the exact effective fallback content before appending the block so no rules disappear. Record provenance in plan, not in user content. |
| How should Codex override precedence work?                | Always `AGENTS.md`; reject override; update effective file                  | Update the active non-empty override. Writing an ignored file is false success; rejecting valid overrides is unnecessary.                                                                                                                                                                                                                               |
| How should Gemini custom filenames work?                  | Always `GEMINI.md`; run model probe; bounded settings parser                | Parse supported user settings and resolve one effective global filename. Reject ambiguous arrays or unsupported routing initially; do not spend model credits for verification.                                                                                                                                                                         |
| Should `install-skill` also write guidance?               | Yes for convenience; no to preserve command scope                           | No. `install-skill` remains skill-only and gains safe official upgrades. `setup` owns combined agent routing/guidance.                                                                                                                                                                                                                                  |
| How should multi-file writes behave?                      | Best-effort; global rollback; snapshot-checked per-file convergence         | Snapshot-check plus stop-on-race and partial result. Only a proved in-call two-sided exchange may be reversed; cross-client CLI and filesystem changes are not one transaction, and broader rollback could overwrite concurrent human edits.                                                                                                            |

## Canonical Assets

Package these immutable inputs under `skills/structural-code-editing/`:

- `SKILL.md` — current skill, version bumped when its activation contract changes.
- `guidance.md` — body inserted inside ownership markers; no client-specific path text.
- `releases.json` — schema version, hash algorithm, current candidate `{version, sha256}`, and registry-proven predecessor entries with npm package-version provenance.

`resolveBundledSkillAssets(executablePath)` replaces the single-path resolver and validates that all three files exist as regular files. Manifest parsing uses a closed schema. Setup hashes source bytes and requires equality with `current.sha256` before classifying destinations.

Proposed markers:

```text
<!-- ast-tool:structural-code-editing guidance v1 begin -->
[canonical guidance]
<!-- ast-tool:structural-code-editing guidance v1 end -->
```

The canonical payload names `structural-code-editing`; it does not contain absolute paths, versions of client binaries, or user-specific data.

## Guidance Destination Resolution

### Claude Code

Resolve `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/CLAUDE.md` relative to setup CWD for relative env overrides, matching existing config semantics.

### OpenCode

Resolve config root using the same environment policy as OpenCode MCP setup. Guidance path is `<config-root>/AGENTS.md`.

- If native global rules exist, manage that file.
- If native rules are absent and Claude fallback exists, treat the fallback bytes as the effective preimage.
- If the Claude fallback path is itself selected for Claude, group both logical outcomes on that one physical path when doing so preserves OpenCode discovery.
- Otherwise create native rules with exact fallback bytes plus the owned block. This intentionally establishes native rules while preserving prior effective content.

The planner must document/test how `OPENCODE_CONFIG` and `OPENCODE_CONFIG_DIR` derive the config root; it must not infer the root from an arbitrary JSON filename without an admitted contract.

### Codex CLI

Resolve `${CODEX_HOME:-$HOME/.codex}`. If non-empty `AGENTS.override.md` exists, it is the effective global target. Otherwise target `AGENTS.md`. An empty override is ignored by Codex and must not receive the block.

### Gemini CLI

Resolve the user settings under `~/.gemini/settings.json` (and admitted environment override if current client documentation supports one). When `context.fileName` is absent, target `GEMINI.md`. Initially support a single string or a one-item array containing a safe filename. Reject multi-name precedence and unsafe paths until an exact deterministic policy is specified and tested.

### Hermes and Copilot CLI

Return a logical `skill_only` plan with no path or physical write.

## Plan Model

```ts
type AssetStatus = "installed" | "updated" | "unchanged";
type GuidanceStatus = AssetStatus | "skill_only";

interface FileSnapshot {
  exists: boolean;
  kind: "missing" | "regular";
  digest?: string;
  mode?: number;
  dev?: string;
  ino?: string;
  directory: {
    anchorDev: string;
    anchorIno: string;
    missingDirectories: string[];
  };
}

interface ManagedFilePlan {
  path: string;
  snapshot: FileSnapshot;
  postimage: Buffer;
  postimageSha256: string;
  status: AssetStatus;
  logicalOwners: Array<{ agent: AgentId; asset: "skill" | "guidance" }>;
}

type ManagedFileCommitState = "committed" | "possibly_committed";
type ManagedFileRollbackState = "succeeded" | "failed";
```

Planners canonicalize through the nearest existing ancestor, authenticate that ancestor and any existing destination by device/inode identity, group aliases, and reject a group if logical owners require different postimages. Snapshot bytes and identity come from the same no-follow descriptor read. Plans retain bytes in memory only for the setup process and never enter diagnostics.

## Managed Block Algorithm

1. Read destination as bytes and classify type without following a final symlink.
2. Accept UTF-8 with optional BOM; reject invalid UTF-8/NUL.
3. Find exact begin/end marker occurrences.
4. Zero pairs: append one blank-line-separated block, preserving existing bytes.
5. One ordered pair: replace exactly begin-through-end.
6. Any other marker state: conflict.
7. Preserve BOM, dominant/existing newline convention, terminal-newline behavior outside the block, and mode.
8. If resulting bytes equal preimage, status is `unchanged`.

## Skill Upgrade Algorithm

1. Validate `releases.json` and source digest.
2. Missing destination: `installed`.
3. Destination digest equals current: `unchanged`.
4. Destination digest equals one admitted predecessor: `updated`.
5. Unknown digest plus explicit force: `updated`.
6. Unknown digest without force: conflict.

The predecessor list is append-only for published official releases proven by downloaded tarball bytes after npm `dist.integrity` verification. The current candidate digest is validated against the packaged source but is not described as published until that package version exists in the registry. Removing a predecessor digest would turn a previously safe managed upgrade into a conflict and requires an explicit migration decision. The active Hermes digest `c25ed470e5c504c38a9be75ffa38f4b6c5a4046548b562e6a33ddba9044fa4d2` is deliberately excluded because it matches neither registry bytes nor Git history.

## Sequence Flow

```mermaid
sequenceDiagram
  participant C as CLI
  participant O as Agent Setup
  participant A as MCP Adapters
  participant S as Skill Planner
  participant G as Guidance Planner
  C->>O: selected agents + force-skill
  par Global preflight
    O->>A: compatibility and MCP inspection
    O->>S: validate assets and classify all skill paths
    O->>G: resolve effective paths and classify all blocks
  end
  alt conflict, unsupported routing, malformed asset, or trust failure
    O-->>C: bounded failure; zero writes
  else preflight passes
    O->>S: descriptor-bound apply and postimage authentication
    O->>G: descriptor-bound apply and postimage authentication
    loop selected agents
      O->>O: reauthenticate all managed postimages
      O->>A: register missing MCP and verify
    end
    O-->>C: schema v2 outcomes and physical writes
  end
```

Asset apply ordering should write shared skill/guidance files before MCP registration, preserving current behavior where installed knowledge exists before a newly registered client starts. A later failure separates proved completed writes, possibly committed writes, successful exact-pair rollbacks, failed rollbacks, and genuinely pending writes. Retry first inspects uncertain state, then replans all state.

## Stable Result Contract

Bump setup success to `version: 2`:

```ts
interface AgentSetupItemV2 {
  agent: AgentId;
  executable: string;
  version?: string;
  mcp: "configured" | "unchanged";
  skill: AssetStatus;
  guidance: GuidanceStatus;
}
```

`physical_writes` includes `{path, asset, status}`. Paths are already part of the existing success result; errors continue to redact provider output according to existing bounded-diagnostic policy. Partial failure details contain `completed_writes`, `possibly_committed`, `rolled_back`, `rollback_failed`, and `pending` operation records, but never postimage/preimage content. A failure after the commit point cannot be collapsed into `pending` merely because postimage verification or cleanup failed. A successfully rolled-back operation remains pending for retry while retaining explicit rollback evidence.

## Files

| File                                             | Action | Purpose                                           |
| ------------------------------------------------ | ------ | ------------------------------------------------- |
| `skills/structural-code-editing/SKILL.md`        | Modify | Correct activation contract and bump version      |
| `skills/structural-code-editing/guidance.md`     | Create | Canonical managed payload                         |
| `skills/structural-code-editing/releases.json`   | Create | Official digest provenance                        |
| `src/services/skill-installer.ts`                | Modify | Manifest validation, planning, official upgrades  |
| `src/services/managed-guidance.ts`               | Create | Routing, block planning/apply/verify              |
| `src/services/agent-setup.ts`                    | Modify | Combined preflight and result v2                  |
| `src/cli.ts`                                     | Modify | Resolve packaged assets; preserve force semantics |
| `test/skill-installer.test.ts`                   | Modify | Digest and safe-upgrade RED/GREEN                 |
| `test/managed-guidance.test.ts`                  | Create | Routing, markers, preservation, races             |
| `test/agent-setup.test.ts`                       | Modify | Combined preflight, result, retry                 |
| `scripts/fixtures/fake-agent.mjs`, smoke scripts | Modify | Six-client isolated effective discovery           |
| `README.md`, `CHANGELOG.md`, setup ADR           | Modify | Public contract and rollout                       |

## Testing Strategy

Strict RED/GREEN by behavior slice:

- manifest schema/source mismatch/current/predecessor/custom/force;
- marker lifecycle, BOM/newlines/mode, invalid UTF-8, symlink/device, duplicate/partial markers;
- Claude custom root, OpenCode native/fallback/custom root, Codex override, Gemini default/single custom/ambiguous custom, Hermes/Copilot skill-only;
- cross-logical alias dedupe and incompatible postimage collision;
- global no-write preflight, same-byte/symlink temporary substitution, final destination substitution with exact-pair rollback, post-commit failure classification, partial result, convergent retry;
- setup schema v2, install-skill scope, source and tarball asset resolution;
- fake six-client CLI/package smokes;
- isolated real installed clients where available, never using the real home.

Canonical verification remains format, lint, typecheck, 576+ tests, build, all smoke commands, fixture admission, audit, package contents, and workflow policy.

## Security and Privacy

- Do not read or emit `.env`, credentials, tokens, or arbitrary provider output.
- Instruction contents never enter errors or telemetry.
- Reject symlink final targets to prevent writing outside resolved ownership.
- On the supported Linux target, require GNU coreutils 9.7 `mv --exchange --no-copy -T`, GNU coreutils `ln -L -T`, `/proc/self/fd`, `O_DIRECTORY`, and `O_NOFOLLOW`; pin parent, preimage, staged, and destination inodes, and fail closed rather than falling back to pathname-only publication.
- Preserve unrelated bytes; force applies only to skill conflict, not malformed guidance markers or unsafe routing.
- Package manifests contain only versions and hashes, no machine paths.

## Rollout and Rollback

Roll out first through fake isolated homes and packed consumers, then isolated homes with locally installed clients. No writes to the operator's real configuration are part of verification.

Rollback reverts package code/assets. It does not automatically remove already installed blocks or downgrade skills; both are valid standalone text artifacts. Verify the previous CLI still ignores/preserves them and MCP registrations remain usable. A future block removal command is separate scope.

## Open Questions

None. Unsupported or ambiguous client routing fails closed rather than being deferred as an implementation guess.
