# Exact-SHA CI remediation specification

## CI-REM-001 — Exact supported GNU `mv`

The CI quality job MUST make `/usr/bin/mv` identify as GNU coreutils 9.7 and MUST prove successful no-replace publication plus collision rejection with `--update=none-fail`, `--no-copy`, and `--no-target-directory` before dependency installation.

If the hosted image does not already satisfy that exact contract, CI MUST download `coreutils-9.7.tar.xz` only from the hard-coded kernel.org GNU HTTPS mirror URL, bound to SHA-256 `e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf`, build it inside the physical `RUNNER_TEMP`, prove the built `mv`, install only that executable to `/usr/bin/mv`, and prove the installed executable again. Unsupported platform/architecture, malformed runner temp, digest mismatch, build failure, install failure, wrong version, unexpected collision status, or postimage mismatch MUST fail closed.

## CI-REM-002 — Node 22.5 package-manager isolation

The CI matrix and local release-candidate matrix MUST remain exactly Node `22.5.0` and current Node 24. Node 22.5 runtime gates MUST retain `--experimental-sqlite`, but CI's `corepack enable` and every matrix's `yarn install --immutable` MUST run with an explicitly empty `NODE_OPTIONS` so neither package-manager process can inherit the experimental runtime flag.

## CI-REM-003 — Test environment isolation

The operation-deadline test MUST use the test framework's environment stub and the existing `afterEach` restoration boundary. It MUST NOT assign `AST_OPERATION_DEADLINE_MS` directly on `process.env` and leak the 1000 ms fixture into later tests.

## CI-REM-004 — Closed workflow authority

The workflow policy MUST require the exact ordered CI command chain including GNU `mv` preparation and the isolated Corepack and Yarn commands. Adversarial tests MUST reject omission or drift of those commands while retaining the exact action, trigger, runner, matrix, permission, key, and skip-control boundaries.

## CI-REM-005 — Successor release identity

Any remediation byte invalidates candidate tree `a7ecdd88739f323c288c0c85102a0d9fdcdb86cc`, its local matrix/canaries, and its Review A/B authorization for release. The successor MUST rerun focused/full gates, exact Node 22.5/24 matrix, four current canaries, archive/readback, and exact-tree reviews before commit and push. Task 7.1 completes only when remote `main` and a successful `ci.yml` push run both equal the successor release SHA.

## CI-REM-006 — External boundary

This change MAY update and push `main` under the operator's Task 7.1 authorization. It MUST NOT dispatch `publish-next`, mutate npm, promote dist-tags, create a tag, or create a GitHub Release.
