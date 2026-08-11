# Exact-SHA CI remediation tasks

## 1. Incident authentication

- [x] Authenticate failed run `31536159898` against pushed SHA `719ce77a059a361111060eb0583fa4579b9abf26`.
- [x] Capture both failed job/step boundaries and their exact logs.
- [x] Reproduce the GNU primitive version gap and validate a hash-pinned coreutils source/build path locally.

## 2. Implementation

- [x] Add the bounded CI-only GNU `mv` preparation/probe script and focused tests.
- [x] Add the preparation gate and Node-option-isolated Corepack/install commands to `ci.yml`.
- [x] Apply the same Node-option installation boundary to the local release-candidate matrix.
- [x] Update the workflow policy and adversarial tests for the exact new command chain.
- [x] Replace the leaked operation deadline assignment with a Vitest environment stub.

## 3. Verification

Status: complete under the task-status reconciliation convention. Review A passed with unresolved Critical/High/Medium `0/0/0` on tree `7922c87d80b1695fd7164dfdf32a7b9957c30f31`; checking the verdict below is the sole authorized successor delta and requires an immutable-claim review before archive.

- [x] Run focused script, policy, canary, and operations tests.
- [x] Run format, lint, typecheck, full test, build, MCP/error/lifecycle/CLI/package smokes, audit, pack manifest, workflow policy, and diff checks sequentially.
- [x] Freeze the successor tree and rerun the exact Node 22.5/24 release-candidate matrix.
- [x] Rerun four current candidate-bound canaries and authenticate checked historical report stability.
- [x] Write `verification.md`.
- [x] Obtain exact-tree Review A with unresolved Critical/High/Medium `0/0/0`.

## 4. Archive and exact-SHA CI

- [ ] Archive this change unchanged, stage only its exact archive delta, and rerun affected exact-tree gates.
- [ ] Obtain Review B with unresolved Critical/High/Medium `0/0/0`.
- [ ] Commit the reviewed tree conventionally and push `main` without rewriting remote history.
- [ ] Require remote `main` and successful `ci.yml` push CI to equal the successor SHA.
- [ ] Confirm no npm publication, dist-tag mutation, tag, or GitHub Release occurred.
