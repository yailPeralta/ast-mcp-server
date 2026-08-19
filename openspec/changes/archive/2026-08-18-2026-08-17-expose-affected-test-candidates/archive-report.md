# Archive Report: Expose Compiler-Backed Affected Test Candidates

## Final state

- **Change**: `2026-08-17-expose-affected-test-candidates`
- **Archive date**: `2026-08-18`
- **Artifact store**: hybrid (OpenSpec filesystem plus Engram)
- **Final status**: archived successfully under ordinary repository policy
- **Archived to**: `openspec/changes/archive/2026-08-18-2026-08-17-expose-affected-test-candidates/`
- **Native status**: `dependencies.archive: ready`; `nextRecommended: archive`; `blockedReasons: []`
- **Action context**: `repo-local`; allowed edit root `/home/yail/Documentos/proyects/ast-mcp-server`
- **Review gate**: structurally absent. Receipt-driven review was disabled/unmanaged and no review was started for this candidate; no review artifacts were required.

## Final-state evidence

The explicit final-state handoff is authoritative over intermediate snapshots:

- The prior verification blocker was fixed: `convention_match` is emitted for custom-only candidate eligibility, while default-recognized candidates retain direct/transitive reasons.
- Independent strict-TDD verification is persisted in the OpenSpec `verify-report.md` and Engram observation `#1047`.
- Final verdict: `pass_with_warnings`; blockers `0`; critical findings `0`; requirements `7/7`; scenarios `11/11`; tasks `12/12`.
- Evidence revision: `sha256:dd8e241a1f3a982dce87ca443057cb78de86967db811c03e1b6184b9232f5ba9`.
- Verify-report SHA-256: `0ac80a1c9fd24ce2cc69ab293f55d4d449802a22713956fb0bcf54f39cb208f3`; `21019` bytes; OpenSpec and Engram mirrors were identical.
- Focused `33/33`, batch `15/15`, full suite `50 files/718 tests`, format, lint, typecheck, build, exact 16-tool MCP, lifecycle, CLI, errors, and package gates passed.
- One nonblocking warning remains: three pre-existing AST diagnostic-session TS1470 findings on unchanged `import.meta`; canonical typecheck and build pass.
- Native attempt settle returned `state: complete`.
- No staging, commit, branch, push, PR, or delivery authorization exists.

## Artifacts read

### OpenSpec filesystem

- `openspec/changes/2026-08-17-expose-affected-test-candidates/proposal.md`
- `openspec/changes/2026-08-17-expose-affected-test-candidates/specs/affected-test-candidates/spec.md`
- `openspec/changes/2026-08-17-expose-affected-test-candidates/design.md`
- `openspec/changes/2026-08-17-expose-affected-test-candidates/tasks.md`
- `openspec/changes/2026-08-17-expose-affected-test-candidates/apply-progress.md`
- `openspec/changes/2026-08-17-expose-affected-test-candidates/verify-report.md`
- `openspec/config.yaml`

### Engram mirrors read

- `#1035` — `sdd/2026-08-17-expose-affected-test-candidates/proposal`
- `#1036` — `sdd/2026-08-17-expose-affected-test-candidates/spec`
- `#1037` — `sdd/2026-08-17-expose-affected-test-candidates/design`
- `#1038` — `sdd/2026-08-17-expose-affected-test-candidates/tasks`
- `#1047` — `sdd/2026-08-17-expose-affected-test-candidates/verify-report`
- `#126` — `sdd-init/ast-mcp-server` (hybrid project context)

The structured status reported `reviewGate` as absent, so no review transaction, ledger, receipt, bundle, or gate-context observations were read or required.

## Task completion gate

The persisted tasks artifact contained no unchecked implementation tasks: `12/12` complete. No stale-checkbox reconciliation was required.

## Specs synced

| Domain                     | Action  | Details                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `affected-test-candidates` | Created | No main spec existed. The delta/full spec was copied mechanically from `openspec/changes/2026-08-17-expose-affected-test-candidates/specs/affected-test-candidates/spec.md` to `openspec/specs/affected-test-candidates/spec.md`. Source and target SHA-256: `6560de4551354155aa8a1cfbf24f708d37040fddd4a921abc153bb555413e7f6`. |

### Verbatim spec-sync `diff -r` output

The required source-versus-temporary-copy `diff -r` completed successfully with empty output:

```text

```

## Archive move

The full change directory was moved mechanically after a pre-move recursive snapshot. The active source directory was removed, and the archive contains proposal, exploration, specs, design, tasks, apply-progress, and verify-report artifacts.

### Verbatim archive-move `diff -r` output

The required pre-move-snapshot-versus-archived-tree `diff -r` completed successfully with empty output:

```text

```

## Preserved unrelated untracked files

The unrelated files remain untracked and unchanged:

- `docs/external-project-opportunities.md` — SHA-256 `dc229499ba545927e89ff9caa8e4b9a624b1b2cf34b747a98c3a3b780e7d01b1`
- `openspec/archive/2026-08-13-improve-agent-setup/verify-report.md` — SHA-256 `df75a6c68d047ef417c74e13db3ac725a1325af21d2ff1067ffcdaf6d1755e9b`

## Closure

The change is fully planned, implemented, independently verified, and archived. The synchronized main spec is now the source of truth for affected test candidate discovery.
