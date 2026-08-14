# Verification: Managed Structural Editing Guidance

## Scope and identity

- Date: 2026-08-13
- Repository: `ast-mcp-server`
- Baseline branch: `main`
- Baseline `HEAD` and `origin/main`: `22b7e62539d28197f5e5ad5dd25fdeb2adcd89a6`
- Local runtime exercised: Node.js `v24.16.0`, Yarn `4.15.0`, Linux `7.0.0-29-generic` x86_64
- Package manifest version: `0.7.2`; npm already exposes immutable published `0.7.2` bytes, so this change is `Unreleased` development work and MUST NOT republish that version
- Skill candidate SHA-256: `0bf35c4d9c8980ec9076b169c6e7001e1eb17cb9e5d7703ad27baf348b996c0a`
- Historical untracked report SHA-256: `df75a6c68d047ef417c74e13db3ac725a1325af21d2ff1067ffcdaf6d1755e9b`
- Archive status: the complete seven-file SDD now resides under `openspec/archive/2026-08-13-managed-structural-editing-guidance/`; Review B remains required on the frozen post-archive tree

Pre-archive implementation tree `db521aa0ac5880a3e1b1263200bd4058f299cdee`, carried only by local synthetic review commit `e3f94892eb6006ff45ac92e4ad433743986bf276`, passed its exact-tree cohort and Review A. The post-archive documentary successor is recorded owner-side after this document moves; its tree identifier is not embedded because this file is part of that tree.

## Rejected predecessor Review A

The predecessor tree `9b4009465c8627d17e7bdd7829f8af4753bd1122` remains immutable historical evidence. Its exact-tree cohort passed 48 files / 610 tests and the complete declared smoke/package/policy ledger. Review A produced two independent results bound to those bytes:

- specification/conformance: `PASS`, Critical 0 / High 0 / Medium 0 / Low 0;
- adversarial filesystem/security: `REQUEST_CHANGES`, Critical 0 / High 0 / Medium 2 / Low 0.

The two Medium findings were:

1. parent and destination identity were not bound through pathname-based `mkdir`/temp/`link`/`rename` mutation, allowing an ancestor substitution to redirect a write;
2. `unchanged` plans returned before snapshot/postimage reauthentication, allowing stale assets to enable later managed-asset or MCP mutation.

That tree is rejected and does not authorize archive, commit, push, or publication. Its conformance PASS is preserved only as a sibling verdict on the rejected bytes; all candidate-dependent gates and Review A were reopened for the repaired successor.

## Rejected successor Review A

The first repaired successor tree `0ce293f06b2436b78e32299e2bd83055ef9094f8` is also immutable historical evidence. Its exact-tree cohort passed 48 files / 616 tests plus the complete declared smoke/package/policy ledger. Review A produced three independent results bound to those bytes:

- specification/conformance: `REQUEST_CHANGES`, Critical 0 / High 0 / Medium 1 / Low 0;
- adversarial filesystem/security: `REQUEST_CHANGES`, Critical 0 / High 0 / Medium 3;
- quality/documentary closure: `PASS` for that tree's bounded lane.

The conformance Medium overlaps the security destination-identity race. The three material security findings were:

1. final pathname rename did not bind the commit atomically to the destination inode validated immediately beforehand;
2. the staged handle closed before pathname-based mode/link/rename steps, so same-byte or symlink substitution could publish another inode;
3. failures after a destination-changing link/rename were reported as pending even when the operation was committed or possibly committed.

That successor is rejected and does not authorize archive, commit, push, or publication. Its quality PASS remains historical only; the exact-tree cohort and every Review A lane were reopened for the descriptor-bound/exchange successor.

## Rejected descriptor-bound successor Review A

Tree `40e18e684861efd79169e91baac5b1ce79a5a937` is immutable historical evidence. Its first-attempt exact-tree cohort passed 48 files / 625 tests plus all declared build, smoke, audit, package, and workflow gates. Replacement Review A produced:

- specification/conformance: `NOT_COMPLETED`, timeout after 600 seconds / 33 API calls, no summary or verdict;
- adversarial filesystem/security: `NOT_COMPLETED`, timeout after 600 seconds / 16 API calls, no summary or verdict;
- quality/tests/documentation: `REQUEST_CHANGES`, Critical 0 / High 0 / Medium 3 / Low 1.

The three Medium findings were:

1. an in-place content or mode edit after final destination validation retained the same inode and escaped the exchanged-identity checks, allowing concurrent bytes to be unlinked during cleanup;
2. new development behavior was recorded under the already-published `0.7.2` heading instead of `Unreleased`;
3. current managed setup bytes claimed Node.js 22.5 support even though their exact-tree cohort exercised only Node.js 24.

The Low finding identified a README promise that diagnostics never contain paths while setup failures intentionally serialize bounded destination paths. This tree is rejected and does not authorize archive, commit, push, or publication. Timeouts remain `NOT_COMPLETED`, never implicit PASS or `REQUEST_CHANGES`; all three lanes must complete on the next immutable successor.

## Requirement traceability

| Requirement                              | Implementation authority                                        | Direct assertions / evidence                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MSG-001 canonical activation policy      | `skills/structural-code-editing/SKILL.md`, `guidance.md`        | Package and CLI smokes inspect packaged/effective guidance; skill and guidance bytes are shipped by pack dry-run.                                                                                                                                                                                                        |
| MSG-002 official release manifest        | `skill-installer.ts`, `releases.json`                           | `skill-installer.test.ts`: closed manifest, digest mismatch, current, npm-proven predecessors, custom/version-label conflict, explicit force, final symlink/type, races; the excluded `c25ed470…` digest is asserted as custom.                                                                                          |
| MSG-003 effective routing                | `managed-guidance.ts`, `agent-targets.ts`, `opencode-config.ts` | `managed-guidance.test.ts`: Claude/OpenCode/Codex/Gemini route and precedence matrix plus Hermes/Copilot `skill_only`; `opencode-config.test.ts`: separate and aliased OpenCode authorities remain isolated.                                                                                                             |
| MSG-004 owned block                      | `managed-guidance.ts`, `managed-file.ts`                        | `managed-guidance.test.ts`: append/update/replay, byte preservation, BOM, LF/CRLF, mode, malformed markers, invalid UTF-8/NUL, symlink/non-regular rejection.                                                                                                                                                            |
| MSG-005 global preflight and races       | `agent-setup.ts`, `managed-file.ts`                             | `agent-setup.test.ts` and `managed-guidance.test.ts`: global zero-write barrier; parent, identical-byte destination, same-inode content/mode, same-byte staged and symlink-staged substitutions; descriptor-bound no-clobber; atomic exchange pair revalidation/rollback; stale `unchanged`; postimage reauthentication. |
| MSG-006 reporting and standalone install | `agent-setup.ts`, `cli.ts`, `skill-installer.ts`                | `agent-setup.test.ts` and CLI/package smokes assert setup schema v2, ordered `mcp`/`skill`/`guidance`, physical write kinds, committed/possibly-committed/rolled-back/rollback-failed/pending states, zero-write replay and standalone skill behavior.                                                                   |
| MSG-007 package and installed clients    | release preflight, CLI/package/installed-agent smokes           | Pack dry-run contains all three assets; tarball smoke runs setup twice for six fake targets; host-dependent smoke verifies five installed clients in disposable homes and reports unavailable Gemini instead of simulating it.                                                                                           |
| Setup delta: safe setup                  | `agent-setup.ts`, client adapters                               | Full setup tests and smokes prove combined preflight, managed assets before MCP registration, current registration preservation and bounded failures.                                                                                                                                                                    |
| Setup delta: shared planning             | `skill-installer.ts`, `managed-guidance.ts`                     | Planner and setup tests assert one shared `.agents/skills` write, guidance aliases, custom-skill fail-closed and force limited to skill replacement.                                                                                                                                                                     |
| Setup delta: stable reporting            | `agent-setup.ts`, `cli.ts`                                      | Setup unit/CLI/package smokes assert one versioned JSON result, stable replay and bounded committed/possibly-committed/rolled-back/rollback-failed/pending diagnostics.                                                                                                                                                  |
| Setup delta: retry                       | `agent-setup.ts`, `managed-file.ts`                             | Direct orchestrator race assertion plus replay convergence in CLI/package smokes.                                                                                                                                                                                                                                        |

## First-remediation worktree verification before rejected successor freeze

All commands below ran sequentially after the final source change unless explicitly identified as a diagnostic run.

| Command                                                      | Observed result                                                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Focused managed-asset suites                                 | PASS, 3 files / 54 tests                                                                                        |
| Managed-asset plus release-preflight suites                  | PASS, 4 files / 92 tests                                                                                        |
| `yarn format:check`                                          | PASS, all matched files formatted                                                                               |
| `yarn lint`                                                  | PASS                                                                                                            |
| `yarn typecheck`                                             | PASS                                                                                                            |
| `yarn test`                                                  | PASS, 48 files / 616 tests, 53.74 s                                                                             |
| `yarn build`                                                 | PASS                                                                                                            |
| `yarn test:agent-fixtures`                                   | PASS, 2 fixtures                                                                                                |
| `yarn test:mcp`                                              | PASS, stdio, 15 tools                                                                                           |
| `yarn test:lifecycle`                                        | PASS, all lifecycle cases, 0 orphan processes                                                                   |
| `yarn test:cli`                                              | PASS, setup and persisted mutation/replay                                                                       |
| `yarn test:errors`                                           | PASS, compiled public error envelope and stderr correlation                                                     |
| `yarn test:package`                                          | PASS, tarball `0.7.2`, 6 installed and 6 idempotent targets                                                     |
| `yarn test:installed-agents`                                 | PASS; Claude, Hermes, OpenCode, Codex and Copilot installed; Gemini unavailable                                 |
| `yarn audit`                                                 | PASS, no audit suggestions                                                                                      |
| `yarn pack --dry-run --json` plus closed required-file check | PASS, 74 entries; includes skill/guidance/manifest, both managed services, `docs/support.md`, and `SECURITY.md` |
| `node scripts/workflow-policy-check.mjs`                     | PASS, 3 workflows / 9 jobs / 24 actions                                                                         |
| Direct skill/manifest SHA comparison                         | PASS, `9599d869cdf7affe6db9093505f53845a45b2ecdc8a04e3562f31e4adbca216d`                                        |
| `git diff --check`                                           | PASS                                                                                                            |

One complete post-remediation attempt failed at 615/616 because the security-policy assertion still required the predecessor's singular primitive wording. The successor assertion now requires GNU `mv`, `/proc/self/fd`, `O_DIRECTORY`, and `O_NOFOLLOW`; its focused test passed, and the complete cohort above then passed from zero. The failed attempt is not counted as passing evidence.

## Second-remediation worktree verification before successor freeze

The descriptor-bound/exchange remediation ran on the owner worktree after its final source and test changes. These results authorize freezing and isolated execution only; they are not Review A approval and are superseded by any later byte change.

| Command / assertion                       | Observed result                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| Focused managed-guidance and setup suites | PASS, 2 files / 49 tests                                                 |
| `yarn format:check`                       | PASS                                                                     |
| `yarn lint`                               | PASS                                                                     |
| `yarn typecheck`                          | PASS                                                                     |
| `yarn test`                               | PASS, 48 files / 625 tests                                               |
| `yarn build`                              | PASS                                                                     |
| `yarn test:agent-fixtures`                | PASS, 2 fixtures                                                         |
| `yarn test:mcp`                           | PASS, stdio, 15 tools                                                    |
| `yarn test:lifecycle`                     | PASS, 0 orphan processes                                                 |
| `yarn test:cli`                           | PASS, setup and persisted apply/replay                                   |
| `yarn test:errors`                        | PASS, compiled bounded public errors                                     |
| `yarn test:package`                       | PASS, tarball `0.7.2`, 6 installed and 6 idempotent targets              |
| `yarn test:installed-agents`              | PASS three consecutive times after the diagnostic described below        |
| `yarn audit`                              | PASS, no audit suggestions                                               |
| `node scripts/workflow-policy-check.mjs`  | PASS, 3 workflows / 9 jobs / 24 actions                                  |
| Direct skill/manifest SHA comparison      | PASS, `e650c2216decf03ce22210c9486c28a87a35c7102f6c7d2a21b4f8ea5a2f507c` |
| Historical untracked-report SHA-256       | PASS, `df75a6c68d047ef417c74e13db3ac725a1325af21d2ff1067ffcdaf6d1755e9b` |
| `git diff --check`; real index            | PASS; empty                                                              |

The first complete worktree cohort and its immediate standalone installed-client retry stopped during initial Copilot version detection with `Version output does not match an admitted contract.` No repository byte changed. Authorized disposable-environment probes then captured `GitHub Copilot CLI 1.0.79.` under `CI=1`, and `detectInstalledAgents` classified it as compatible with `copilot-mcp-v1`. A fresh complete setup for all five installed clients passed, followed by three consecutive installed-client smoke passes. This is retained as transient host-client diagnostic evidence, not as a waived gate: the immutable exact-tree cohort below must pass the installed-client smoke on its first attempt.

## Third-remediation worktree verification before successor freeze

After remediating Review A for tree `40e18e68…`, the final implementation/test bytes passed the following sequential owner-worktree cohort. These results authorize freezing only and remain superseded by the immutable exact-tree cohort.

| Command / assertion                                      | Observed result                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Focused managed-guidance, setup, and workflow-policy run | PASS, 3 files / 72 tests                                                          |
| `yarn format:check`                                      | PASS                                                                              |
| `yarn lint`                                              | PASS                                                                              |
| `yarn typecheck`                                         | PASS                                                                              |
| `yarn test`                                              | PASS, 48 files / 631 tests                                                        |
| `yarn build`                                             | PASS                                                                              |
| `yarn test:agent-fixtures`                               | PASS, 2 fixtures                                                                  |
| `yarn test:mcp`                                          | PASS, stdio / 15 tools                                                            |
| `yarn test:lifecycle`                                    | PASS, 0 orphan processes                                                          |
| `yarn test:cli`                                          | PASS, setup and persisted apply/replay                                            |
| `yarn test:errors`                                       | PASS, compiled bounded public errors                                              |
| `yarn test:package`                                      | PASS, tarball `0.7.2`, `Unreleased` plus historical version headings, 6/6 targets |
| `yarn test:installed-agents`                             | PASS; five installed clients, Gemini unavailable                                  |
| `yarn audit`                                             | PASS, no audit suggestions                                                        |
| `node scripts/workflow-policy-check.mjs`                 | PASS, 3 workflows / 9 jobs / 24 actions                                           |
| Pack dry-run and closed required-file check              | PASS, 74 entries / 7 required / 0 missing                                         |
| Direct skill/manifest SHA comparison                     | PASS, `0bf35c4d9c8980ec9076b169c6e7001e1eb17cb9e5d7703ad27baf348b996c0a`          |
| `git diff --check`; real index                           | PASS; empty                                                                       |

Two intermediate focused attempts failed only newly added assertions: the first retained a descriptor-relative test path after its directory handle closed and an older security-policy phrase; the second exposed the remaining capitalization-sensitive policy phrase. The test retained a stable real path and the truthful support wording restored the policy contract. No failed attempt is counted as passing evidence, and the complete cohort above ran after the final implementation/test correction.

## Installed-client evidence

The host-dependent smoke built first and used disposable HOME/config roots only. It made no model calls and did not use the operator's real client homes.

- Claude: native guidance path and MCP client discovery.
- OpenCode: shared Claude fallback and routed MCP client discovery. Diagnostic/effective-config execution used disposable copies because OpenCode mutates both `OPENCODE_CONFIG` and `$OPENCODE_CONFIG_DIR/opencode.json`.
- Codex: client-visible guidance discovery without a model call and MCP client discovery.
- Hermes: `skill_only`, MCP client discovery, and byte-exact preservation of a preexisting sentinel `SOUL.md`.
- Copilot: `skill_only` and MCP client discovery.
- Gemini: unavailable locally; fake-client and packed-consumer coverage proves the admitted deterministic route, but this host does not supply real-client Gemini evidence.

A separate authorized probe established that `hermes mcp list` initializes `SOUL.md` only when pointed at a completely empty synthetic `HERMES_HOME`; it preserves an existing `SOUL.md` byte-for-byte. The final smoke therefore pre-seeds a sentinel and asserts exact preservation.

## Final pre-archive exact-tree cohort and Review A

The owner created a temporary index from baseline `22b7e62539d28197f5e5ad5dd25fdeb2adcd89a6` using the explicit 35-path allowlist. It produced tree `db521aa0ac5880a3e1b1263200bd4058f299cdee` and local synthetic carrier `e3f94892eb6006ff45ac92e4ad433743986bf276` without touching the real index. The historical report remained excluded and retained SHA-256 `df75a6c68d047ef417c74e13db3ac725a1325af21d2ff1067ffcdaf6d1755e9b`.

The isolated cohort passed on its first attempt: immutable install; format; lint; typecheck; 48 files / 631 tests; build; agent-fixture, MCP, lifecycle, CLI, error, package, and installed-client smokes; audit; workflow policy; pack dry-run with 74 entries / 7 required / 0 missing; and `git diff --check`. Post-cohort authentication confirmed the exact tree, clean execution surface, 35-path manifest, empty real index, matching skill digest, and preserved historical report.

Three independent read-only Review A lanes then reauthenticated the same tree immediately before verdict:

| Lane                           | Verdict | Critical | High | Medium | Low |
| ------------------------------ | ------- | -------- | ---- | ------ | --- |
| Specification / conformance    | PASS    | 0        | 0    | 0      | 0   |
| Filesystem / security          | PASS    | 0        | 0    | 0      | 0   |
| Code, tests, docs, and closure | PASS    | 0        | 0    | 0      | 0   |

Review A therefore authorizes documentary reconciliation and archive only. The synthetic carrier is not a product commit, and commit, push, PR, remote CI, npm, dist-tags, tag, and release remain pending explicit authorization. Any implementation-byte edit would invalidate this evidence and reopen Review A.

## Security and residual risk

- No real agent home, Hermes `SOUL.md`, repository instruction file, `.env`, credential file, registry, remote branch, tag, or release was modified.
- No commit, push, PR, npm publish, dist-tag mutation, or remote CI transition occurred.
- Automatic upgrade trust is limited to exact SHA-256 values derived from npm tarballs whose `dist.integrity` was verified. Frontmatter and Git history alone are not authority.
- File application is atomic per destination and convergent, not globally transactional across files or external CLIs. On the supported target, GNU coreutils 9.7 `mv --exchange --no-copy -T`, GNU coreutils `ln -L -T`, `/proc/self/fd`, `O_DIRECTORY`, `O_NOFOLLOW`, held descriptors, device/inode checks, pinned preimage digest/mode revalidation, and exact-pair rollback revalidation bind creation/replacement commits and postimages; killed coreutils children are awaited through `close` before mutation state is classified, and no pathname-only publication fallback is used.
- Real-client Gemini discovery is unverified on this host because the binary is unavailable.
- Only Node.js `v24.16.0` was exercised in this local cohort. The package declares `>=22.5.0`, but current-candidate documentation therefore treats Node 22.5 as the package engine floor and published-v0.7.2 evidence rather than claiming fresh support for the `Unreleased` managed setup-file implementation.
- Registry consumer execution is intentionally not used as candidate evidence: the registry currently exposes the previously published `0.7.2`, not these uncommitted bytes.
