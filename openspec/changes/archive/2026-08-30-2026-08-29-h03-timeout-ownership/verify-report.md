```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:a644bc73adad09ef5d3efc295eb6722f45a4c0a54490f1d20733f11f4b8d2cee
verdict: pass
blockers: 0
critical_findings: 0
requirements: 4/4
scenarios: 8/8
test_command: env -u GIT_PAGER yarn test && env -u GIT_PAGER yarn test:dsh-adapter
test_exit_code: 0
test_output_hash: sha256:849686a3eb8de787a85f9b0705af172221e3f5f342a8d90f786fad8704df33df
build_command: env -u GIT_PAGER yarn format:check && env -u GIT_PAGER yarn lint && env -u GIT_PAGER yarn typecheck && env -u GIT_PAGER yarn build
build_exit_code: 0
build_output_hash: sha256:17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20
```

# Verification Report

- **Candidate:** tree `2f2dacf95060d6e0f47a360e1a4ff070b24b410a`; Harness `dsh-v0.1.2-alpha.1` / `cd5ef8148158c3a752a658978873241fdf8e2bbc`; 17/17 tasks complete.
- **Published outer timeout exceeds complete AST budget (2/2):** shipped `30000/120000/15000/180000` ordering passes; missing, non-integer, equality, non-positive margin, and insufficient headroom fail before smoke acceptance.
- **Deterministic slow work reports AST operational error (1/1):** exact-host `100/1000/100/1500` returns stable AST codes and rejects `ToolTimeoutError`, `TOOL_TIMEOUT`, and unrelated `AbortError`.
- **Slow-path cancellation, correlation, and cleanup (3/3):** cold generation 1 returns `OPERATION_DEADLINE_EXCEEDED`; queued generation 1 returns `QUEUE_WAIT_TIMEOUT` with zero starts; recycled successor generation 2 returns `REQUEST_CANCELLED`; call/fixture/generation/correlation joins hold and cleanup reports active/held/listeners/processes zero with disposable state removed.
- **Pinned identity drift blocks evidence (2/2):** exact host/bridge/AST/adapter/config/Node/native identities permit execution; missing or mismatched identity returns `BLOCKED` before H-03 control creation and emits no compatibility pass.
- **Execution:** format, lint, typecheck, build, 73/73 files with 914/914 tests, 31/31 focused tests, exact native H-03/H-01a/H-02 smoke, and `git diff --check` all passed; hashes are bound above.
- **Judgment Day:** `judgment-day.json` is APPROVED after 2/2 re-judges closed JD-H03-001, with zero open or fix-caused severe findings.
- **CI/delivery:** mandatory Node 22.13.0 and 24 quality legs passed, including exact smoke; #109/#111/#113 merged and PR #115 remains OPEN, CLEAN, all checks successful.
- **Rollback:** revert #115, then #113, #111, and #109; rerun focused Vitest and `yarn build && yarn test:dsh-adapter`.
- **Risks:** merge remains a post-archive action; local exact-host used Node 24.16.0 while CI supplies Node 22.13.0; no coverage collector is configured.

**PASS:** 4/4 requirements and 8/8 scenarios have fresh passing evidence; blockers, critical findings, and warnings are zero.
