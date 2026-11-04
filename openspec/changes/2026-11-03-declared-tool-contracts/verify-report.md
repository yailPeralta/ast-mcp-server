# Verification Report: declared tool contracts

- Change: `2026-11-03-declared-tool-contracts` (issue #383, tracker #384; U1a #385, U1b #386, U2 #387)
- Verified head: `feat/declared-tool-contracts-u2-descriptions` (chain head, clean tree)
- Mode: Strict TDD, hybrid artifact store
- Verdict: **PASS WITH WARNINGS** (0 CRITICAL, 3 WARNING, 3 SUGGESTION)

## Completeness

| Metric                           | Value                                                                |
| -------------------------------- | -------------------------------------------------------------------- |
| Implementation tasks             | 23/23 checked (U1 1.1-1.12, U2 2.1-2.11)                             |
| Pre-apply checklist              | 0.1-0.4 done (0.2/0.3 were stale checkboxes, fixed with this report) |
| Specs / requirements / scenarios | 3 / 12 / 23 (DTC 10/20, ATR-R8 1/2, ATN-R8 1/1)                      |
| Scenarios compliant              | 23 of 23, each with a test that passed at runtime                    |

## Runtime evidence (each command run once at the U2 head)

| Command                                      | Exit | Result                                                                          |
| -------------------------------------------- | ---- | ------------------------------------------------------------------------------- |
| `yarn typecheck`                             | 0    | clean                                                                           |
| `yarn lint`                                  | 0    | clean                                                                           |
| `yarn format:check`                          | 0    | All matched files use Prettier code style                                       |
| `yarn build`                                 | 0    | clean                                                                           |
| `env -u GIT_EDITOR yarn test --maxWorkers=4` | 0    | 93 files passed; 1344 passed, 2 skipped; supervised-worker 2 passed             |
| `yarn test:package`                          | 0    | passed                                                                          |
| `env -u GIT_EDITOR yarn test:dsh-adapter`    | 0    | `DSH_ADAPTER_SMOKE_OK`                                                          |
| `yarn test:local-registry`                   | n/a  | skipped in verify; apply evidence exit 0 with `exact_tool_inventory: true` (W2) |

Smoke evidence `summary.h02.declaredContracts`: baseline `0.13.0`; `ast_find_references` declared (public `654bca0d...` != candidate `79107bf4...` == declared); `ast_rename_symbol` declared (public `6a12d1a2...` != candidate `fe34b154...` == declared); every other tool undeclared with equal digests; `undeclaredSha256` public == candidate (`1e10f5dc...`).

Commit hygiene: no attribution trailers in `main..HEAD`. Frozen scope: `git diff --stat main...HEAD` lists only the permitted implementation, test, docs and openspec files; `test/mcp.integration.test.ts` and `test/supervised-worker.integration.test.ts` untouched.

## TDD compliance

| Check                 | Result | Details                                                                                        |
| --------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| TDD evidence reported | OK     | U2 table in `apply-progress.json`; U1 trail in task text and commit sequence                   |
| All tasks have tests  | OK     | Every code task names an existing test file                                                    |
| RED confirmed         | OK     | Actual RED outputs recorded (empty entries, description failures, pin mismatches, canary)      |
| GREEN confirmed       | OK     | All listed files pass                                                                          |
| Triangulation         | OK     | 7 malformed shapes, strictness `true`/`{}`/declared, digest cases over name/description/schema |
| Safety net            | OK     | 32/32 on the U1b base before U2                                                                |

Task 2.5 was green on write by design (wiring came from 1.10) and is verified by the real smoke run. Assertion quality: no tautologies or ghost loops; loops assert non-empty inputs first.

## Spec traceability

M = `scripts/lib/declared-tool-contracts.mjs`, T = `test/declared-tool-contracts.test.ts`, D = `test/dsh-adapter.test.ts`.

| Spec    | Scenario                                             | Code                              | Test                                                            | Status                   |
| ------- | ---------------------------------------------------- | --------------------------------- | --------------------------------------------------------------- | ------------------------ |
| DTC-R1  | description drift / schema drift / unchanged         | M:76-82, 213-221                  | T:188, T:198, T:182, T:266                                      | COMPLIANT                |
| DTC-R2  | description or schema differs; declared matches      | M:58-73                           | T:225, T:235, T:208, T:257, T:588 (oracle)                      | COMPLIANT                |
| DTC-R3  | stale declaration                                    | M:67-72                           | T:247, T:257                                                    | COMPLIANT                |
| DTC-R4  | unknown / missing / ast_explore                      | M:200-211, 205-206                | T:286, T:296, T:321, T:331; smoke explore asserts intact        | COMPLIANT                |
| DTC-R5  | semantic equality; strictness                        | M:17-40, 222-233                  | T:50, T:86, T:266, T:433, T:457, T:467                          | COMPLIANT                |
| DTC-R6  | baseline mismatch; empty declarations; fixture shape | M:196, 213-221, 192               | T:393, T:506, T:28, T:37, T:353                                 | COMPLIANT                |
| DTC-R7  | baseline advances (stale rule enforces removal)      | M:67-72                           | T:247; D "documents the declared tool contract rule"            | COMPLIANT (indirect, S1) |
| DTC-R8  | evidence recorded                                    | M:117-136; smoke 2155-2160        | T:529; D "smoke records per-tool declaredContracts"; real smoke | COMPLIANT                |
| DTC-R9  | unit-testable; smoke cannot skip                     | pure module; no `process.exit`    | T (whole file); D; real smoke                                   | COMPLIANT                |
| DTC-R10 | pins consistent; canary from own run                 | three pins                        | T:619; `mcp.integration.test.ts:534`; supervised-worker         | COMPLIANT                |
| ATR-R8  | not diagnosed; exact description                     | `src/tools/find_references.ts:88` | `test/tools/find_references.test.ts`; T:588; `angular-docs`     | COMPLIANT                |
| ATN-R8  | exact description                                    | `src/tools/rename_symbol.ts:31`   | `test/tools/rename_symbol.test.ts`; T:588                       | COMPLIANT                |

## Design conformance

Module purity (only `node:crypto`, never throws), exports and `.d.mts`, smoke wiring (module and fixture imported, local `semanticSchema` and blanket equality removed, `ast_explore` assertions intact, `summary.h02.declaredContracts`, `toolContracts` stripped before `h01a`), fixture in semantic form and fixed points, pins (inventory == registry `b7e8f28b...`, canary `48d24031...` independent), descriptions byte-exact in source, fixture, tests and specs, docs clauses with guards. All seven recorded deviations verified as recorded.

## Issues

CRITICAL: none.

WARNING

- W1. `tasks.md` 0.2/0.3 were unchecked although done (#383 approved, tracker #384 exists). Fixed with this report.
- W2. `yarn test:local-registry` not re-run in verify; registry pin covered at runtime by T:619 and by the apply-phase run (`exact_tool_inventory: true`).
- W3. `apply-progress.json` top-level `gates` were stale (U1 counts). Refreshed with this report. Native ledger unavailable in this build for both units.

SUGGESTION

- S1. DTC-R7 is verified indirectly; a test feeding an advanced public baseline equal to a declaration would make it direct.
- S2. Nothing asserts the canary pin differs from the inventory pin; independence is held by process.
- S3. ADR addendum dated 2026-11-04 (local date at landing).

## Verdict

PASS WITH WARNINGS. Ready for merge in chain order (#385 -> tracker, #386, #387, then undraft #384) and archive.
