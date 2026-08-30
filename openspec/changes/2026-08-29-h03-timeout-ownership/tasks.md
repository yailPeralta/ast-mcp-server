# Tasks: H-03 Timeout Ownership

## Review Workload Forecast

| Field          | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Authored lines | 650–900                                                |
| Strategy       | ask-on-risk                                            |
| Split          | PR 1 budget → PR 2 seam → PR 3 runtime → PR 4 delivery |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main (approved by user); tracker: https://github.com/yailPeralta/ast-mcp-server/issues/107
400-line budget risk: High

### Suggested Work Units

| Unit | Goal            | Focused test                                                            | Runtime harness       | Rollback              |
| ---- | --------------- | ----------------------------------------------------------------------- | --------------------- | --------------------- |
| 1    | Budget contract | `yarn vitest run test/dsh-adapter.test.ts`                              | N/A: static contract  | metadata/patch/test   |
| 2    | Closed seam     | `yarn vitest run test/dsh-adapter.test.ts test/runtime-process.test.ts` | N/A: component seam   | fixture/runtime files |
| 3    | Slow paths      | `yarn build && yarn test:dsh-adapter`                                   | pinned native Harness | smoke phase           |
| 4    | Delivery gates  | `yarn format:check && yarn lint && yarn typecheck && yarn test`         | CI adapter job        | docs/CI               |

## Phase 0: Delivery Gate

- [x] 0.1 Created approved tracker #107 with scope, acceptance, rollback, and four-PR chain.
- [x] 0.2 User selected `stacked-to-main` and explicitly approved continuing from the 440-line snapshot under a Phase-1-only `size:exception` capped at 450 changed lines for PR 1.

## Phase 1: Budget Contract (RED → GREEN → REFACTOR)

- [x] 1.1 RED — In `test/dsh-adapter.test.ts`, reject missing/non-integer values, non-positive margin, equality, insufficient headroom, and patch drift.
- [x] 1.2 GREEN — Add the sole timeout tuple to `package.json`; derive `config.toolCallTimeoutMs` in `cordis.patch.yml` from installed metadata.
- [x] 1.3 REFACTOR — Share a validator between static and smoke checks; retain defaults `30000/120000/15000/180000`.

## Phase 2: Minimal Closed Seam (RED → GREEN → REFACTOR)

- [x] 2.1 RED — Prove `src/server.ts` still registers exactly 15 guarded tools and malformed fixture descriptors fail closed.
- [x] 2.2 RED — Test hold/release, abort, queued-never-started, same-ID regeneration, stale post-await rejection, and in-memory resource cleanup.
- [x] 2.3 GREEN — Implement an `AST_H03_FIXTURE`-gated hook for use inside an existing tool's scheduler admission; add no tool. Parse/forward the closed descriptor, validate its directory when consumed, and retain nonce/generation in drained events.
- [x] 2.4 REFACTOR — Expose the explicit Phase-3-consumable hook without exact-host wiring or scheduler re-entry; keep process/disposable-state cleanup assertions in Phase 3.

## Phase 3: Exact-Host Evidence (RED → GREEN → REFACTOR)

- [x] 3.1 RED — In `scripts/dsh-adapter-smoke.mjs`, require host/bridge/AST/adapter/Node identities; mismatch returns `BLOCKED` before fixtures.
- [x] 3.2 RED — Add cold deadline, queued no-late-start, and recycle stale-generation assertions; reject `ToolTimeoutError`, `TOOL_TIMEOUT`, and unrelated `AbortError`.
- [x] 3.3 GREEN — Use `100/1000/100/1500`, events, call/correlation/generation joins, bounded JSON errors, and `finally` cleanup readback.
- [x] 3.4 REFACTOR — Deduplicate bounded helpers in `scripts/runtime-process.mjs`; run `yarn build && yarn test:dsh-adapter`.

## Phase 4: Docs, Review, CI, Delivery

- [x] 4.1 Update `docs/roadmap.md` with H-03 evidence/exclusions and rollback: `git revert <PR-sha>`, then focused command.
- [x] 4.2 Run blind adversarial review of scenarios, fixture invisibility, drift, classification, cleanup, and budget; fix findings RED-first.
- [ ] 4.3 Run `yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build`; confirm `.github/workflows/ci.yml` keeps `yarn test:dsh-adapter` mandatory.
- [ ] 4.4 Deliver ordered issue-linked PRs with evidence, rollback boundary, and successor base.
