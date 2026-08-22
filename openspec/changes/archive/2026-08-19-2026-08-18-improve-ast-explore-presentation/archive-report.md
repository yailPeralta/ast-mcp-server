# Archive Report: Improve `ast_explore` Presentation

## Closure

- Change: `2026-08-18-improve-ast-explore-presentation`
- Artifact store: hybrid (OpenSpec filesystem + Engram)
- Archived path: `openspec/changes/archive/2026-08-19-2026-08-18-improve-ast-explore-presentation/`
- Archive date: 2026-08-19
- Native pre-archive status: `applyState: all_done`, tasks `15/15`, `blockedReasons: []`, `nextRecommended: archive`.
- Review authority: `reviewGate` structurally absent; receipt-driven review was disabled, so archive proceeded under ordinary repository policy. No review topics were read or created.

## Artifacts Read

The complete filesystem artifacts and their Engram mirrors were read before archival. Engram observation IDs: proposal `#1057`, spec `#1058`, design `#1060`, tasks `#1061`, apply-progress `#1068`, verify-report `#1108`.

At archive time, hybrid parity was checked using trimmed Markdown bodies (allowing only the documented terminal-LF difference from Engram `TrimSpace`). All six artifacts matched then: proposal, concatenated spec, design, tasks, apply-progress, and verify-report.

## Task Completion

The archived `tasks.md` contains all 15 implementation tasks checked (`15/15`, `0` pending). Filesystem SHA-256: `49a342624d9042cceb1e3f929eb58b99d146aafda83849e454b66c5ea525ae6a`.

## Specs Synchronized

Each delta was a new domain spec, so it was copied mechanically into the canonical OpenSpec tree. Every copy was followed by `diff -r`; each command exited 0 with empty output.

| Domain               | Canonical path                                            | SHA-256                                                            |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| Cluster presentation | `openspec/specs/ast-explore-cluster-presentation/spec.md` | `b61af1f6f3daed83fcf20523fe02a467d1b43e37e795c0cbf07515b4b5726364` |
| Omission metadata    | `openspec/specs/ast-explore-omission-metadata/spec.md`    | `f0ee839c7fa4cecdc93bf2e840625d3e69626467ff1a298f2575358b92490a2e` |
| Call spines          | `openspec/specs/ast-explore-call-spines/spec.md`          | `5cda04d99c158472b28bed719158654d75e1bf5ebfb572bab2e8146076ff99c7` |
| Batch parity         | `openspec/specs/ast-explore-batch-parity/spec.md`         | `d1b81b98627ff6ee217d5623fcf0245a44554bba261735acc0f3ebefab25d310` |

The later PR #23 correction also synchronized the canonical and archived `symbol-index-persistence` contract at SHA-256 `08f56a52220d15d1b28686e5dc4cef258eea0f9afd6ce6cd329887fa2ec1900c`.

## Mechanical Archive Readback

The source directory was snapshotted with `cp -R`, moved with shell `mv` (the source was untracked; `git mv` could not acquire the read-only Git index lock), and confirmed absent. Verbatim recursive readback:

```text
verbatim diff -r snapshot vs archived tree:
diff-r exit 0, empty output
```

The archive contains `proposal.md`, `specs/` (four domains), `design.md`, `tasks.md`, `apply-progress.md`, `verify-report.md`, and this additive report. At archive time, the pre-move hashes included apply-progress `195405afa2019d1db9b52579c3c193fc5a336446727f2e0463c739ee832a1eea` and verify-report `ec9de43b29350589142797d3e10e8ecf4c8e72f4702a90ee97360c64837c283a`. The currently integrated formatting-normalized verify report preserves the evidence semantics but has SHA-256 `8c48085d20dec82c7a911963063c172bc5c5e638967ad51bef38352de17c5a40`; `ec9de43b...` is the historical pre-move hash, not the current artifact hash.

## Final State at Close

- Historical verification snapshot: PASS; requirements `4/4`, scenarios `12/12`, CRITICAL `0`, WARNING `2` (both non-blocking); evidence revision `sha256:7174a517a7a3da470914c6fde077643e186159075589558c5544d2c54486c349`. At that snapshot, focused benchmark tests `11/11` and the full suite `53 files / 748 tests` passed with format, lint, typecheck, and build.
- Runtime proof: exactly two benchmark runs after correction; both exit 0 with all six gates true; run 1 changed bytes, run 2 was a no-op. Tracked SHA-256 `56038cac3b1c9da1d6aa1c5e26a981cb3f36389e791262105c59ceddaa244d75`, size `8,580` bytes, mode `664`, mtime `1787172575`; no third run.
- Native final verification settled `state: complete`; remediation settlement manifest `sha256:d2b02c93593bd044e3f8e0d7476877a8bb220c56ca849b368b925b039376bd54` records authoritative `76/300` accounting. A 156-line manual path diff was non-authoritative.
- Post-verification correction PR #23 (`458e84ffd5ba7117fcbe285c59ae11f0279ca48b`, merged as `bd412e9b9012e4c64831d9e6d0784dd783d6c17a`) decoupled optional SQLite persistence health from compiler freshness. Compiler-backed memory reads now remain fresh while failed persistence stays visible through public `index` and `index_observability`; stable capability fallback reuses memory until restart or policy change, while transient and corrupt failures remain retryable.
- Post-PR #23 correction evidence: `keeps capability fallback fresh and reuses one compiler-backed memory index`; `keeps compiler reads fresh during stable persistence fallback`; and `falls back to compiler search when an indexed selector mismatches`. The affected suites passed `73/73`, the full suite passed `752/752`, format/build/typecheck/lint passed, and compiler-backed production diagnostics were `0`.
- Current final correction evidence after PR #25 (`f27f15a92d142430ed6d204cb0eb5629e6dee53f`, merged as `a0b435203efa7263e5caed72fa5a91eca3c7fb69`): tight valid byte budgets omit the complete optional call-spine aggregate atomically instead of returning an internal error, while ample budgets preserve all 40 paths. The affected suites passed `58/58`, the full suite passed `754/754`, format/build/typecheck/lint and MCP/CLI smokes passed, and compiler-backed production diagnostics were `0`.
- Remaining disclosed non-blockers: three pre-existing project-wide TS1470 AST diagnostics; benchmark `.mjs` is outside active tsconfig and its textual inspection is disclosed as non-compiler-backed. Canonical typecheck and changed-source diagnostics passed.
- The original archive phase performed no staging, commit, branch, push, PR, or delivery operation.

## Post-Archive Proof

- Active path `openspec/changes/2026-08-18-improve-ast-explore-presentation/` is absent.
- Archived path and all expected artifacts exist; canonical specs are present and hash-verified.
- Native status after move reports `changeRoot: null`, no active artifact paths, and `blockedReasons: ["Active OpenSpec change not found: 2026-08-18-improve-ast-explore-presentation."]`, which is the expected closed/archived state for the active-change dispatcher.
- At archive time, existing unrelated working-tree changes were not modified; only the expected canonical spec additions and archived change path were added by that phase.

## Next Step

The SDD cycle is complete. This final passive handoff prepares the corrected archive evidence for delivery under ordinary repository policy; it does not push, merge, tag, or release anything.
