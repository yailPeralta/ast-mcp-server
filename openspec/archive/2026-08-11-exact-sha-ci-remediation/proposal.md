# Exact-SHA CI remediation

## Problem

The first exact-SHA CI run for the reviewed `0.7.0` candidate, GitHub Actions run `31536159898`, failed on both required runtime cells:

- Node `22.5.0` inherited `NODE_OPTIONS=--experimental-sqlite` during `yarn install --immutable`; Yarn 4.15.0 terminated its link step with exit code 42 and `unexpected empty event loop`.
- Node 24 reached the full suite on Ubuntu 24.04, whose GNU coreutils 9.4 `mv` lacks `--update=none-fail`. The checked-evidence publication tests therefore failed before the supported no-replace primitive was available.
- A test that assigned `AST_OPERATION_DEADLINE_MS` directly leaked the 1000 ms test value to later operation tests. Under the slower hosted runner, 22 otherwise unrelated mutation tests then failed with `OPERATION_DEADLINE_EXCEEDED`.

The push itself and remote-main readback succeeded, but Task 7.1 remains blocked because CI is not green on the exact SHA.

## Intent

Create a successor release candidate that preserves the product semantics while making CI execute the already-declared support contract reproducibly:

1. provision an exact, hash-pinned GNU coreutils `mv` supporting the required no-replace primitive before package-manager or test gates;
2. keep Node 22.5 SQLite flags on runtime gates without leaking them into Corepack or Yarn installation;
3. restore test-local environment isolation for the deadline fixture;
4. bind the revised workflow to the closed workflow policy and adversarial tests;
5. invalidate the previous candidate evidence, rerun the complete local matrix/canary/review bridge, and require successful CI on the new pushed SHA.

No npm publication, dist-tag mutation, tag, or GitHub Release is authorized by this remediation.
