# Design: Recover Honest Relationship Coverage

## Technical approach

Re-author U1–U7 on a fresh #188 chain from revalidated `origin/main`; never cherry-pick. OpenSpec is authoritative; prohibited Harness/control-plane mirroring is skipped.

```text
main → draft tracker → U1→U2→U3→U4→U5→U6→U7→#186→#187
 → pre-archive verify → archive/spec merge → final review/verify/CI/Harness → integration
```

`ast_get_impact` resolves a fresh root, creates one tracker, runs BFS/producers, aggregates coverage, then projects Zod JSON/TOON. `relationships.ts` owns producers/exactness; `impact.ts` traversal/completeness; tools schemas; candidates consume admitted evidence.

## Decisions

| Area                     | Design                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage                 | Total internal registry: kind/direction/endpoint-class. Aggregate to exactly one public requested kind/direction cell (14 maximum), with `unfinished > unsupported > completed > not_applicable`; order kinds `reference,import,export,extends,implements,call,contains`, then incoming/outgoing. This intentionally adapts old 28-row evidence to authoritative RCR-001. |
| Completeness             | Require fresh compiler authority, no bound/cancellation, unexhausted work, and every cell completed/not-applicable. Only complete zero results are `proven_empty`.                                                                                                                                                                                                        |
| Work                     | One injected `CompilerImpactWorkTracker` spans BFS, producers, probes, retention, sorting, dedupe, emission. U2 establishes sharing; #187 proves every charge exactly once at exact-bound/one-below.                                                                                                                                                                      |
| Calls                    | U3 adds isolated incoming/outgoing scoped producers and no guessed edge. #186 must replace provisional dispatch with receiver/member-owner authority covering accessors, private/`#private`, interface/base/property and recursive incoming cases. Until then: kill switch.                                                                                               |
| Contains                 | Direct module→named top-level and named owner→named child; incoming is exact inverse. Exclude statements, parameters, anonymous/runtime owners, and producer-transitive edges.                                                                                                                                                                                            |
| Candidates/compatibility | U5 freezes six incoming kinds, excludes `contains`, validates bounded coverage/work before pagination, and fails closed. Four JSON/TOON tools retain `output_format` and no universal MCP `outputSchema`. Cancellation returns `REQUEST_CANCELLED`, never partial authority.                                                                                              |

## Re-author, units, and rollback

For each unit inspect only `git diff <sha>^ <sha> -- <allowlist>`, re-author on its immediate parent, and stop on foreign hunks. Record parent/tree, evidence SHA, allowlist, old-patch and new-diff/tree SHA-256, lines, tests, links, review/CI receipts, rollback. Old OpenSpec, execution state, receipts, Judgment/corrections, settlements, hashes, CI, Harness snapshots, and approvals grant no authority.

| Unit/base; budget       | Files                                                                       | Conflict/rollback                                         |
| ----------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| U1/tracker; 51          | `test/mcp.integration.test.ts`                                              | deterministic RED twice; revert test.                     |
| U2/U1; 353              | `impact.ts`, `read-contracts.ts`, `relationships.ts`, `test/impact.test.ts` | adapt 28→14; revert ledger/tracker/tests.                 |
| U3/U2; 320              | `relationships.ts`, `tools/get_impact.ts`, `test/impact.test.ts`            | #186 supersedes classifier; revert producer/schema/tests. |
| U4/U3; 337              | `relationships.ts`, `test/impact.test.ts`                                   | #187 changes charging only; revert contains/tests.        |
| U5/U4; 288              | three services, three tools, MCP/schema/candidate tests                     | adapt schema to 14; revert contract/gate/tests.           |
| U6/U5; 202              | `read-contracts.ts`, explore/status tools, impact/MCP/read-contract tests   | adapt matrix; revert matrix/vocabulary.                   |
| U7/U6; 32               | changelog, README, ADR 0007/0012, Harness report                            | rewrite current truth; revert docs.                       |
| #186/U7; 300–480        | relationship service plus impact/MCP/relationship/call-spine tests          | split ≤400; no accounting edits.                          |
| #187/#186; own forecast | impact/relationship services and accounting tests                           | no dispatch edits; each slice ≤400.                       |

U1 targets tracker; later PRs target immediate predecessors. Ancestor work is a base bug. U1–U7 use `Refs #188`; children close only themselves; integration closes #188.

## Verification and authority

Each unit runs focused tests plus cumulative U1; U7 runs format, lint, typecheck, tests, build, MCP/lifecycle/CLI/error/package smokes, and diff-check. #186/#187 are independent reviewed, verified, rollback-capable kill switches.

After both pass, freeze and verify 14/31. Only then archive and merge #188/#186/#187 deltas into specs. Archive changes bytes, so freeze again for fresh review (never #161 Judgment), strict verify, CI, format/YAML/diff hashes, and integration authority. Byte/finding/gate drift invalidates receipts.

Harness stays read-only: pinned adapter/catalog and `yarn test:dsh-adapter`; snapshots hash identically; 15 guarded tools; apply absent; direct apply `UNKNOWN_TOOL`. Writes block integration.

## Trace

| Requirements | Architecture/verification                           |
| ------------ | --------------------------------------------------- |
| RCR-R1..R2   | U2 ledger/precedence; U5 gate; U6 matrix.           |
| RCR-R3       | U2 tracker/U6 cancellation/#187 final charging.     |
| RCR-R4..R5   | U1/U3/#186 calls; U4 containment.                   |
| RCR-R6       | U5–U7, children, Harness kill switch.               |
| RCA-R1..R2   | protected tracker; immediate-parent ≤400 admission. |
| RCA-R3..R4   | fresh receipt families; old authority rejected.     |
| RCA-R5..R6   | independent children; one post-archive candidate.   |
| ATC-R1..R2   | U5 six-kind gate; U6 fail-closed matrix.            |

| Scenarios    | Owner                                           |
| ------------ | ----------------------------------------------- |
| RCR-001..004 | U2/U5/U6 order, states, empty/unsafe.           |
| RCR-005..008 | U2/U3/U6/#186 work, cancel, directional calls.  |
| RCR-009..012 | U4 containment; U5/U7 compatibility/merge lock. |
| RCA-001..004 | tracker/base/drift and slice admission.         |
| RCA-005..008 | links, closure, old rejection, fresh identity.  |
| RCA-009..012 | child kill switches and final evidence drift.   |
| ATC-001..004 | six-kind/no-contains and bound/shape rejection. |
| ATC-005..007 | exhaustion, cancellation, proven-empty proof.   |

## Threat matrix and rollout

N/A: no routing, subprocess, VCS/PR automation, or executable classifier changes; chain checks are process verification. No migration/flag. Coverage/work is additive; exact-shape clients adapt. Before merge abandon/rebuild; after merge revert integration atomically.
