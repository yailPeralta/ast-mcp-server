# Verification: Improve Agent Setup

Status: archived under ordinary repository policy

Date: 2026-08-13
Implementation commit: `83956c82b6baa10430a86251957a5ea890e5e8cf`
Implementation tree: `d9a63c6314cc25d931ae90f7452cbf934598ce21`
Delivery mode: receipt-driven development disabled; review disabled/unmanaged

## Closure authority

The implementation and its remediation are complete. `apply-progress.md` records the strict-TDD cycles, final remediation, requirement mapping, and observed local results: 47 test files and 576 tests passed, with build, lint, and typecheck also passing.

`verify-report.md` is immutable historical FAIL evidence for the earlier 574/575 attempt. Its SHA-256 is `df75a6c68d047ef417c74e13db3ac725a1325af21d2ff1067ffcdaf6d1755e9b`. It remains untracked and is not the final verdict for the remediated implementation.

Gentle AI issue #3130 prevents the automated SDD state machine from recognizing the completed evidence-bound remediation. The operator therefore authorized this archive through ordinary repository policy while receipt-driven development remains disabled. This does not rewrite the failed attempt or claim that the automated blocker was repaired.

Final archive-candidate gates execute after this record is frozen. Their command output and candidate-tree readback remain external owner evidence so this document does not recursively invalidate the candidate it describes.

## Requirement traceability

| Requirement | Implementation | Assertion/runtime evidence |
| --- | --- | --- |
| Detection and compatibility | `src/services/agent-targets.ts` | `test/agent-targets.test.ts`, `test/agent-setup.test.ts` |
| Deterministic selection | `src/services/setup-wizard.ts`, `src/cli.ts` | `test/setup-wizard.test.ts`, CLI/package smokes |
| Native checkbox interaction | `src/services/checkbox-state.ts`, `src/services/raw-tty.ts` | `test/raw-tty.test.ts`, `test/setup-wizard.test.ts` |
| Safe client MCP setup | `src/services/agent-setup.ts`, `src/services/agent-targets.ts` | `test/agent-setup.test.ts`, CLI/package smokes |
| OpenCode routing | `src/services/opencode-config.ts` | `test/opencode-config.test.ts`, `test/agent-setup.test.ts` |
| Shared skill planning | `src/services/skill-installer.ts` | `test/skill-installer.test.ts` |
| Stable bounded reporting | `src/services/agent-setup.ts`, `src/cli.ts` | `test/agent-setup.test.ts`, public-error smoke |
| Idempotency and partial retry | `src/services/agent-setup.ts` | `test/agent-setup.test.ts`, CLI/package replay smokes |

All 8 requirements and all 11 scenarios have direct passing evidence. The three proposal success criteria and all 18 implementation tasks are complete.

## Residual risks and deferred scope

- Gemini and GitHub Copilot binaries were unavailable locally. Their admitted normalized fixtures and fake-runtime/package smokes pass, while unknown output remains fail-closed. Installed release-candidate recapture remains a publication concern, not an archive blocker.
- The six adapter objects remain centralized in `agent-targets.ts` instead of separate source files. This is a documented design-layout deviation, not a behavioral requirement failure.
- Cursor, Windsurf, Cline, and other editor-integrated clients remain intentionally out of scope.
- Setup remains convergent across independent client tools rather than transactionally atomic.

## External transitions

This archive performs no push, pull request, tag, registry publication, or hosted release.
