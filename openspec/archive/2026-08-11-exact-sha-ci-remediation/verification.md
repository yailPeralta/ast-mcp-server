# Exact-SHA CI remediation verification

## Decision boundary

This change remediates GitHub Actions run `31536159898` without weakening product/runtime contracts. It does not authorize or perform npm publication, dist-tag mutation, tagging, or GitHub Release creation.

The previously reviewed candidate tree `a7ecdd88739f323c288c0c85102a0d9fdcdb86cc` and pushed commit `719ce77a059a361111060eb0583fa4579b9abf26` remain immutable incident evidence. They are not release-authorized after these bytes change. A successor tree requires fresh matrix, canary, archive, review, commit, remote readback, and exact-SHA CI evidence.

## Requirement traceability

| Requirement  | Implementation                                                                                                                                                                                                                  | Verification                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CI-REM-001` | `scripts/ci-prepare-gnu-mv.mjs`, `.d.mts`, and the preparation step in `.github/workflows/ci.yml`                                                                                                                               | Exact source descriptor unit test; host probe; Ubuntu 24.04 container fallback from GNU coreutils 9.4 to hash-pinned 9.7; built and installed success/collision postimage probes |
| `CI-REM-002` | `NODE_OPTIONS= corepack enable` and `NODE_OPTIONS= yarn install --immutable` in CI plus per-command install isolation in `scripts/release-candidate-matrix.mjs`, while preserving the Node 22.5 SQLite option for runtime gates | Workflow policy acceptance and adversarial command-drift rejection; runner environment regression test; local immutable install PASS                                             |
| `CI-REM-003` | `vi.stubEnv("AST_OPERATION_DEADLINE_MS", "1000")` in `test/operations.test.ts`                                                                                                                                                  | Focused operations suite 27/27 PASS; full suite includes the same file without deadline cascades                                                                                 |
| `CI-REM-004` | Closed `CI_RELEASE_GATES` chain and three adversarial workflow mutations                                                                                                                                                        | Workflow policy tests 17/17 PASS; direct policy result PASS for 3 workflows, 9 jobs, 23 pinned actions                                                                           |
| `CI-REM-005` | New OpenSpec change and explicit invalidation boundary                                                                                                                                                                          | Fresh exact-tree matrix/canaries and Reviews A/B are mandatory before successor push                                                                                             |
| `CI-REM-006` | No release workflow dispatch or registry transition in this change                                                                                                                                                              | Git/GitHub/npm boundary readback before closure                                                                                                                                  |

## Incident evidence

The exact pushed SHA's CI jobs failed at separate boundaries:

- Node `22.5.0`: dependency installation exited 42 while inheriting `--experimental-sqlite`.
- Node 24: dependency installation, format, lint, and typecheck passed; the full test step failed because Ubuntu 24.04 GNU coreutils 9.4 lacks `mv --update=none-fail`, and a direct environment assignment leaked a 1000 ms operation deadline into later tests.

No rerun of the failed SHA is treated as remediation evidence because the source tree itself required correction.

## Platform bootstrap evidence

The source artifact is exactly:

- URL: `https://mirrors.kernel.org/gnu/coreutils/coreutils-9.7.tar.xz`
- bytes: `6,158,960`
- SHA-256: `e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf`

The digest was independently reproduced from the kernel.org GNU mirror, Debian's pristine upstream archive, the earlier GNU endpoint download, and the Nix source pin.

A disposable Ubuntu 24.04 Linux x64 container began with `mv (GNU coreutils) 9.4`. Running the CI preparation as a non-root runner with passwordless `sudo` built the pinned source, proved the uninstalled binary, installed only `/usr/bin/mv`, proved success and collision postimages again, and returned:

```json
{ "status": "pass", "version": "9.7", "source": "pinned-gnu-source" }
```

The final container readback was `mv (GNU coreutils) 9.7`. Earlier attempts that failed due to a build timeout, inaccessible upstream endpoint, or root-only configure guard are negative diagnostic evidence only and are not counted as PASS.

## Current local gates

All gates below ran sequentially after the remediation implementation:

- immutable install: PASS;
- format check: PASS;
- lint: PASS;
- typecheck: PASS;
- focused CI/bootstrap/matrix/workflow/operations/canary tests: 76/76 PASS;
- full Vitest suite: 529/529 PASS across 43 files;
- build: PASS;
- MCP smoke: PASS, 15 tools;
- public-error smoke: PASS;
- lifecycle smoke: PASS with zero orphan processes;
- CLI smoke: PASS;
- package smoke: PASS for `0.7.0`, lifecycle scripts disabled;
- audit: no suggestions;
- dry-run package manifest: 67 files including required `SECURITY.md` and `docs/support.md`;
- workflow policy: PASS, 3 workflows / 9 jobs / 23 pinned actions;
- `git diff --check`: PASS.

## Preliminary exact-tree evidence manifest

The first fully reconciled pre-archive tree was authenticated as synthetic commit `36c7ef0c198e6b8eec73b366d7a89494dbb45d26`, tree `f5ce85fb48ed3d30d75b0dd6f18a990ea6d40de3`, with sole parent `719ce77a059a361111060eb0583fa4579b9abf26`. Its exact-tree evidence is retained here as preliminary evidence because adding this durable manifest necessarily creates a successor tree.

The Node matrix completed with 15/15 commands and zero failed, timed-out, or signalled commands per runtime:

- summary: SHA-256 `71754317917e06c04fffdc726a8f8936e0a35561e869ef759e6c06799ecfd50d`;
- Node `v22.5.0`: SHA-256 `16dd45f107895618a4a9b74cfde269885c747a4fa087a58c6612bf96fe6f36fb`;
- Node `v24.16.0`: SHA-256 `3ce49ebc00302eb188d1410d3f5c94ec05766537d4321624aa1e168445964659`.

Four candidate-bound canaries each passed 40/40 top-level gates, had zero false deterministic-fixture gates, and retained 20 iterations plus 3 restarts:

- `ast-mcp-server` / Node 24: SHA-256 `3f7330b678b021476919c12495e5c98d2aba78203f0b84b5c824972fd919a8f8`;
- `ast-mcp-server` / Node 22.5: SHA-256 `795f10362f9497198390f1d315440f32951b056729774e61344bc9380e91a4e1`;
- `x-scraper` / Node 24: SHA-256 `3252156afe17f2e75c33b284bd568239944f156747da7530e25dc8a88f23b602`;
- `x-scraper` / Node 22.5: SHA-256 `5a897ac1c68e538b7d77db1f525f834e52692b99c3184a596966ae920fb36762`.

The checked historical report hashes remained byte-identical:

- `ast-mcp-server-node22.5.json`: `16c545d6b9916aee20be6c7865b85a54b999ae79067c0ff34a7968b69333fecf`;
- `ast-mcp-server-node24.json`: `a091698c22a02dbafe027788d6d0ad118c04af7e60fdc69db6bb6a68704752a9`;
- `x-scraper-node22.5.json`: `5f600a147601f0d5b8b92245209184289f16fa555697026a1fc1bfad87233039`;
- `x-scraper-node24.json`: `1b35639df50f1f185519cb65545e7609f5b253f34edd6a7a2bba995482cacf42`.

The changed-diff sensitive-value scan was empty, SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. The index remained the exact candidate tree with no unstaged or untracked paths, and the physical `x-scraper` checkout remained clean.

Preliminary Review A passed the security/workflow and root-cause/regression slices at unresolved Critical/High/Medium `0/0/0`. The evidence/SDD slice returned `0/0/1` solely because these exact identities and hashes were not yet durable; this manifest is the remediation for that finding and does not claim that preliminary Review A was an overall PASS.

These gates and the preliminary manifest establish implementation health, not release authorization. Because this manifest changes bytes, the successor candidate MUST rerun the exact Node matrix, four current canaries, and complete Review A before the unchanged archive transition. Review B, commit, push, and remote CI readback remain separate evidence phases.
