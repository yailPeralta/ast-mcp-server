# Isolated Harness output-validation candidate

These development patches implement the direction in [ADR0016](../../../docs/adr/0016-harness-output-validation.md) for #103.

Upstream: <https://github.com/deepseek-ai/deepseek-harness>, immutable base `cd5ef8148158c3a752a658978873241fdf8e2bbc` (`dsh-v0.1.2-alpha.1`). Preserve its MIT notice in `LICENSE`.

Apply an ordered, verified patch prefix only to a separate clean checkout of that base. A partial prefix exposes only its documented API; it is not a supported MCP output-validation runtime.

Full enforcement requires the candidate core and bridge together. Identical package version strings do not identify that pair. Source checks do not replace built CLI/Loader, recorded-session and installed-consumer verification.

The default baseline and active GUI are not modified. These files do not authorize package publication or installation.

## Source preparation and CLI

Run `NODE_OPTIONS='' node scripts/issue-103/prepare-harness.mjs` with Node 24.16.0 and the existing trusted Git/private-manager prerequisites. Optional `--work <empty-root>` uses an explicit root. This provisions private pnpm 11.7.0, independently clones the official baseline and candidate, and applies all tracked patches in order with `--check --index` then `--index`. **It does not install Harness dependencies, build or execute Harness.**

`readSeries()` reads the AST repository by default. It binds exact UTF-8 manifest bytes to the actual Git HEAD blob, verifies the pinned upstream/base/tree/scope and safe unique patch filenames, and returns ordered, hash-checked in-memory patch bytes. Explicit repository paths must be canonical. The existing trusted Git configuration requires SHA-1 repositories; other object formats, symlinked inputs and changed or missing inputs reject.

`claimWork()` allocates a unique canonical OS-temporary root outside AST ancestry. An explicit root must already be canonical, empty, caller-owned and not group/world-writable; unsafe or occupied content is preserved. **A successful claim returns only a caller-owned directory, not preparation success. The caller must clean it up.** This validation is not an exclusive lock against concurrent writers.

`prepare()` validates inputs before work/provisioning, then acquires `.preparing` inside its cleanup lifecycle. Failure removes preparation children only after marker acquisition; failed automatic claims roll back their empty root, while explicit other-owner collisions preserve content. Success returns and writes `identity.json` with actual input HEAD, series/ordered patch hashes, source hashes, trees and Node/Git/private-manager identities; the CLI prints that receipt. **Success transfers root cleanup to the caller:** retain needed evidence, then remove only that verified owned root. `privateEnvironment()` reuses the existing isolated package-manager owner; its files/caches remain below the external work root.

Run `NODE_OPTIONS='' node --test scripts/issue-103/setup.test.mjs`. The complete suite requires official Git network access for real clone/patch failures; it does not install Harness. Native marker-permission tests require an ordinary non-root POSIX user. Temporary fixtures resolve aliases before use; leaf symlinks remain rejected.

Next: the private command runner, including its explicitly designed exit contract. These source-only receipts and tests are not Harness build, host compatibility, installability, apply-capability or publication proof; default runtime and active GUI remain unchanged.
