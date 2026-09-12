# Isolated Harness output-validation candidate

These development patches implement the direction in [ADR0016](../../../docs/adr/0016-harness-output-validation.md) for #103.

Upstream: <https://github.com/deepseek-ai/deepseek-harness>, immutable base `cd5ef8148158c3a752a658978873241fdf8e2bbc` (`dsh-v0.1.2-alpha.1`). Preserve its MIT notice in `LICENSE`.

Apply an ordered, verified patch prefix only to a separate clean checkout of that base. A partial prefix exposes only its documented API; it is not a supported MCP output-validation runtime.

Full enforcement requires the candidate core and bridge together. Identical package version strings do not identify that pair. Source checks do not replace built CLI/Loader, recorded-session and installed-consumer verification.

The default baseline and active GUI are not modified. These files do not authorize package publication or installation.

## Preparation boundaries (API only)

`scripts/issue-103/prepare-harness.mjs` currently exports only `readSeries`, `trustedGit`, `claimWork` and `sha256`. **There is no CLI, preparation orchestrator, private manager, receipt, clone or runtime execution.** The same module will gain preparation in a later unit.

`readSeries()` reads the AST repository by default. It binds exact UTF-8 manifest bytes to the actual Git HEAD blob, verifies the pinned upstream/base/tree/scope and safe unique patch filenames, and returns ordered, hash-checked in-memory patch bytes. Explicit repository paths must be canonical. The existing trusted Git configuration requires SHA-1 repositories; other object formats, symlinked inputs and changed or missing inputs reject.

`claimWork()` allocates a unique canonical OS-temporary root outside AST ancestry. An explicit root must already be canonical, empty, caller-owned and not group/world-writable; unsafe or occupied content is preserved. **A successful claim returns only a caller-owned directory, not preparation success. The caller must clean it up.** This validation is not an exclusive lock against concurrent writers.

Run the focused boundary tests with `NODE_OPTIONS='' node --test scripts/issue-103/setup.test.mjs` using the existing Node 24.16.0 and trusted Git owners. No network or Harness installation is needed.

Next: restore the complete preparation/private-environment/receipt/clone-apply owner and CLI with deterministic marker-failure cleanup and other-owner preservation regressions; then add the private command runner. Boundary tests are not Harness build, host compatibility, installability or publication proof.
