# Tasks: External-writer-safe apply publication

## Review Workload Forecast

Estimate: planning 516–546; implementation 1,350–1,650 lines. PR limit: ≤400 lines/≤60 minutes.

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Only tracker merges to `main`; children target predecessors.

```text
main ← tracker ← planning-1 (exploration+proposal, 233) ← planning-2 (spec+design+tasks, 283–313)
```

```text
planning-2 ← impl-1 hooks+REDs (340–390) ← impl-2 primitive (320–380)
 ← impl-3 adapters+GREEN (330–390) ← impl-4 rollback+mapping (330–390)
 ← impl-5 invariants+docs+gates (280–360)
```

PR bodies mark `📍`; record dependency, scope, follow-up, lines/time.

| PR         | Focused command                                 | Runtime harness                            | Rollback             |
| ---------- | ----------------------------------------------- | ------------------------------------------ | -------------------- |
| planning-1 | `git diff --check`                              | N/A: planning                              | exploration+proposal |
| planning-2 | `git diff --check`                              | N/A: planning                              | spec+design+tasks    |
| impl-1     | `yarn vitest run test/operations.test.ts`       | N/A: internal seam                         | hooks+races          |
| impl-2     | `yarn vitest run test/managed-guidance.test.ts` | `node scripts/ci-prepare-gnu-mv.mjs probe` | primitive            |
| impl-3     | `yarn vitest run test/operations.test.ts`       | capability probe above                     | adapters             |
| impl-4     | `yarn test:errors`                              | public-error smoke                         | tokens+mapping       |
| impl-5     | `yarn test`                                     | `yarn test:dsh-adapter`                    | invariants+docs      |

During apply, `apply-progress.json` records each transition before/after: status, test id/file, command/result, timestamp; then update checkbox.

## Phase 0: Planning delivery

- [x] 0.1 Deliver planning-1: `exploration.md`+`proposal.md`, 239 lines. Verify: `git diff --check`.
- [x] 0.2 Deliver planning-2 atop it: `spec.md`+`design.md`+`tasks.md`; no implementation. Verify: `git diff --check`.

## Phase 1: Seam and RED (impl-1)

- [x] 1.1 Replace `src/services/operations.ts` hooks with deterministic `onFilePhase(operationId,file,index,phase)` barriers. Verify: `yarn typecheck`.
- [x] 1.2 RED `operations.test.ts`: replacement/same-inode bytes+mode preserve externals as `CONFLICT`; no sleeps. Verify: `yarn vitest run test/operations.test.ts -t "replacement|same-inode"`.
- [x] 1.3 RED creation/overlapping configs: competitor/B current, stage unpublished. Verify: `yarn vitest run test/operations.test.ts -t "creation|distinct configurations"`.
- [x] 1.4 RED multi-file/rollback/unsupported: preserve competitors, ambiguous/blocked, zero effects. Verify: `yarn vitest run test/operations.test.ts -t "multi-file|rollback|unsupported"`.

## Phase 2: GREEN (impl-2→impl-3)

- [x] 2.1 Extract authenticated driver to `src/services/authenticated-publication.ts`; adapt `src/services/managed-file.ts`, retaining held-inode, timeout/signal, exact-pair parity. Verify: `yarn vitest run test/managed-guidance.test.ts`.
- [x] 2.2 GREEN held no-clobber creation in `src/services/operations.ts`; competitor→`CONFLICT`. Verify: `yarn vitest run test/operations.test.ts -t "creation"`.
- [x] 2.3 GREEN exchange replacement/same-inode/overlapping configs. Verify: `yarn vitest run test/operations.test.ts -t "replacement|same-inode|distinct configurations"`.

## Phase 3: Ownership (impl-4→impl-5)

- [x] 3.1 Add reverse `CommitToken` rollback; restore owned state or preserve entries and stop ambiguous. Verify: `yarn vitest run test/operations.test.ts -t "rollback|multi-file"`.
- [x] 3.2 Map typed bounded/path-free outcomes in `src/services/public-errors.ts`. Verify: `yarn vitest run test/public-errors.test.ts && yarn test:errors`.
- [x] 3.3 Preserve receipt/replay/cancellation completion-critical behavior. Verify: `yarn vitest run test/operations.test.ts -t "receipt|replay|cancellation"`.
- [x] 3.4 REFACTOR shared ownership/cleanup after GREEN. Verify: `yarn typecheck && yarn vitest run test/operations.test.ts test/managed-guidance.test.ts`.
- [x] 3.5 Align `README.md`, `docs/support.md`, `docs/adr/0001-secure-yarn-and-agent-setup.md` with verified Linux x64 matrix/no fallback. Verify: `yarn format:check`.

## Phase 4: Gates

- [x] 4.1 Run `yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build && node scripts/ci-prepare-gnu-mv.mjs probe && yarn test:package`; persist results.
- [x] 4.2 Harness/catalog regression is applicable: `yarn test:dsh-adapter && yarn vitest run test/dsh-adapter.test.ts test/tool-catalog.test.ts`; prove apply absent and direct invocation denied.
