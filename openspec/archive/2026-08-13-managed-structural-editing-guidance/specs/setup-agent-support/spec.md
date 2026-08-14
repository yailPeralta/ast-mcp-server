# Setup Agent Support Delta Specification

## Modified Requirements

### Requirement: Safe client MCP and managed-asset setup

Setup MUST preflight artifacts, compatibility, MCP registrations, official skill-release evidence, every physically deduplicated skill destination, and every effective guidance destination before the first write. Conflict, unknown inspection, trust failure, unsupported instruction routing, malformed managed markers, or concurrent preflight change MUST cause no writes.

`ast` MUST use the current Node executable and packaged server path. Claude SHALL use scoped get/add; Hermes list/test/add; Codex and Copilot SHALL use structured get/list JSON and add; Gemini SHALL use connection-aware list and user-scoped add; OpenCode SHALL retain its admitted JSON/JSONC route. Missing registrations MUST be verified and current registrations MUST remain unchanged.

After global preflight succeeds, setup MUST apply snapshot-checked managed assets before sequential MCP mutation and verification. A failure after a managed-file commit point MUST classify that operation as committed or possibly committed rather than pending. Partial reporting MUST preserve completed, possibly committed, successfully rolled-back, rollback-failed, and genuinely pending operations and MUST NOT claim cross-file transactional rollback.

#### Scenario: Global managed-asset conflict

- GIVEN every MCP registration is missing or current
- AND one selected skill or guidance destination is conflicting, unsafe, or ambiguously routed
- WHEN global preflight runs
- THEN no MCP registration, skill, or guidance file changes

#### Scenario: Register after managed assets

- GIVEN all selected MCP and managed-asset plans pass preflight
- WHEN setup applies the plan
- THEN current skill and guidance assets are present before a missing MCP registration is added and verified

### Requirement: Shared managed-asset planning

Setup MUST plan skill and guidance outcomes before writes. Skills MUST use client-specific paths for Claude and Hermes and the shared user `.agents/skills` path for OpenCode, Codex, Gemini, and Copilot. Guidance MUST use only verified effective user-global surfaces for Claude, OpenCode, Codex, and Gemini; Hermes and Copilot MUST report `skill_only` and MUST NOT receive invented global instruction files.

Identical physical paths MUST be classified and written once but reported for every logical client. Skill content matching the current candidate MUST remain unchanged. Registry-proven predecessor skill content MUST update automatically. Unknown/custom skill content MUST block all writes unless `--force-skill` authorizes only that skill replacement. Managed guidance MUST preserve non-owned bytes and MUST NOT be overridden by `--force-skill` when markers, routing, type, encoding, or snapshots are unsafe.

#### Scenario: Deduplicated skill and guidance paths

- GIVEN multiple clients resolve to one physical skill or effective guidance path
- WHEN setup succeeds
- THEN each physical postimage is written at most once and each logical client receives the correct outcome

#### Scenario: Unknown skill with official version label

- GIVEN a skill claims an official frontmatter version but its digest is not admitted by the registry-proven release manifest
- WHEN setup runs without `--force-skill`
- THEN it is treated as unknown/custom and every selected target remains unchanged

### Requirement: Stable bounded managed-setup reporting

Machine mode MUST emit one versioned stable JSON value on stdout with ordered per-agent results, physically deduplicated writes, and partial completion. Each agent result MUST include `mcp`, `skill`, and `guidance`; guidance MUST be one of `installed`, `updated`, `unchanged`, or `skill_only`. Managed-asset failure details MUST separate `completed_writes`, `possibly_committed`, `rolled_back`, `rollback_failed`, and `pending`.

Commands MUST retain finite timeout/output limits. Diagnostics MUST identify client, operation, class, and actionable reason while excluding instruction contents, environment values, secrets, raw provider output beyond existing bounded evidence, and managed preimages/postimages.

#### Scenario: Stable replay result

- GIVEN setup already converged
- WHEN machine-mode setup runs again
- THEN all MCP and managed assets report unchanged or `skill_only`, `physical_writes` is empty, and one stable success value is emitted

### Requirement: Idempotency and partial retry

Repeated setup MUST report current registrations and managed assets unchanged. Before each planned file write, setup MUST revalidate the preflight snapshot. A concurrent change MUST stop subsequent writes without overwriting the changed destination and MUST report completed, possibly committed, successful/failed rollback, and pending outcomes using bounded diagnostics.

After a later asset or client failure, retry MUST re-inspect all MCP and managed-asset state, retain already current work, and converge unresolved outcomes without rewriting completed current files.

#### Scenario: Snapshot race and retry

- GIVEN one managed asset completed and another destination changed after preflight
- WHEN apply reaches the changed destination
- THEN setup stops without overwriting it and reports partial completion
- WHEN the conflict is corrected and setup retries
- THEN completed work remains unchanged and pending work converges
