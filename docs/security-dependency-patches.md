# Minimal Hono and Vitest security patches

Deliver [#294](https://github.com/yailPeralta/ast-mcp-server/issues/294) independently before revalidating #220/#293. This prerequisite changes dependency versions, not compiler authority or the Harness integration contract.

## Version decision

| Dependency      | Before  | Patched target | Reason                                                                                                    |
| --------------- | ------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| Hono resolution | 4.12.34 | 4.13.5         | First patched version for the three Hono advisories below; admitted by SDK 1.30.0's `^4.11.4` range       |
| Vitest          | 4.1.10  | 4.1.11         | First patched version on the existing major line; its seven sibling packages are pinned together upstream |

Keep the existing Vitest caret policy (`^4.1.11`) and lock its exact patch. No SDK, Vite, TypeScript, ts-morph, Zod, or unrelated direct dependency upgrade. Broad major updates proposed by Dependabot #3/#53 remain independent decisions.

## Security evidence

- Hono: [SSG output traversal](https://github.com/advisories/GHSA-gqvv-2mrq-wpjv), [nested body memory amplification](https://github.com/advisories/GHSA-g6gw-c38x-mqfc), and [fragment/query interpretation](https://github.com/advisories/GHSA-crvj-82cr-hjcx).
- Vitest and its mocker: [redirect-mock file read](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).
- Baseline `#293@6cbd686` passed preceding CI quality/runtime steps on Node 22.13.0 and 24 but failed `yarn audit` in run `34612200815`.

The new dependency-policy test fails against the baseline: one failing test with 12 failed assertions, while the previous policy test passes. It checks exact manifest/lock versions, absence of parallel old copies, and unchanged installation restrictions. The live recursive audit supplies independent advisory evidence; the policy test alone does not prove security.

## Installation and verification

The target versions were published before the existing 1,440-minute Yarn age gate. Remove the obsolete `hono@4.12.34` preapproval rather than replacing it. Retain `enableScripts: false`; add no age override, advisory exclusion, or audit-severity reduction. Yarn generates lockfile checksums; they are not edited manually.

Required gates: immutable installation, dependency-policy regression, recursive audit, full tests, typecheck/lint/format, compiled MCP/package smokes, independent review, and exact delivery-head Node 22/24 CI. Locally use `env -u NODE_OPTIONS -u GIT_PAGER yarn test` because release-evidence tests intentionally reject those inherited runtime controls; do not weaken the tests.

## Retained PSS measurement caveat

The first candidate suite and a direct probe failed the unchanged 1,048,576-byte parent idle-PSS growth threshold. A bounded A/B on Node 24.16.0, identical 400-file fixtures, original versus patched dependencies, and unchanged runtime source then produced baseline PASS/FAIL and candidate PASS/PASS. The failing baseline parent grew 1,294,336 bytes; the earlier failing candidate parent grew 1,805,312 bytes. All functional checks passed and temporary fixtures/worktree were removed.

This reproduces an intermittent gate on the original dependencies; it does not isolate the precise cause, prove absence of leaks, or erase earlier failures. Keep the mandatory final-candidate supervised and CI checks unchanged. Direct diagnostic passes are not a substitute for those gates; PSS measurement redesign is outside this security patch.

## Rollback boundary

Revert only this prerequisite's manifest, generated lock, Yarn policy, dependency-policy test, and this record. That restores the known audit failures and blocks delivery again; it does not undo #220's separate call-authority correction. Never treat an archived verification record or upstream package metadata as proof of a newly changed candidate.
