# Isolated Harness output-validation candidate

These development patches implement the direction in [ADR0016](../../../docs/adr/0016-harness-output-validation.md) for #103.

Upstream: <https://github.com/deepseek-ai/deepseek-harness>, immutable base `cd5ef8148158c3a752a658978873241fdf8e2bbc` (`dsh-v0.1.2-alpha.1`). Preserve its MIT notice in `LICENSE`.

Apply an ordered, verified patch prefix only to a separate clean checkout of that base. A partial prefix exposes only its documented API; it is not a supported MCP output-validation runtime.

Full enforcement requires the candidate core and bridge together. Identical package version strings do not identify that pair. Source checks do not replace built CLI/Loader, recorded-session and installed-consumer verification.

The default baseline and active GUI are not modified. These files do not authorize package publication or installation.

## Source preparation and CLI

Run `NODE_OPTIONS='' node scripts/issue-103/prepare-harness.mjs` with Node 24.16.0 and the existing trusted Git/private-manager prerequisites. Optional `--work <empty-root>` uses an explicit root. This provisions private pnpm 11.7.0, independently initializes SHA-1 baseline and candidate repositories, records the exact official origin, fetches only the admitted base SHA at depth one with complete blobs, checks out that SHA detached, and applies all tracked patches in order with `--check --index` then `--index`. **It does not install Harness dependencies, build or execute Harness.**

`readSeries()` reads the AST repository by default. It binds exact UTF-8 manifest bytes to the actual Git HEAD blob, verifies the pinned upstream/base/tree/scope and safe unique patch filenames, and returns ordered, hash-checked in-memory patch bytes. Explicit repository paths must be canonical. The existing trusted Git configuration requires SHA-1 repositories; other object formats, symlinked inputs and changed or missing inputs reject.

`claimWork()` allocates a unique canonical OS-temporary root outside AST ancestry. An explicit root must already be canonical, empty, caller-owned and not group/world-writable; unsafe or occupied content is preserved. **A successful claim returns only a caller-owned directory, not preparation success. The caller must clean it up.** This validation is not an exclusive lock against concurrent writers.

`prepare()` validates inputs before work/provisioning, then acquires `.preparing` inside its cleanup lifecycle. Failure removes preparation children only after marker acquisition; failed automatic claims roll back their empty root, while explicit other-owner collisions preserve content. Success returns and writes `identity.json` with actual input HEAD, series/ordered patch hashes, source hashes, trees and Node/Git/private-manager identities; the CLI prints that receipt. **Success transfers root cleanup to the caller:** retain needed evidence, then remove only that verified owned root. `privateEnvironment()` reuses the existing isolated package-manager owner; its files/caches remain below the external work root.

Run `NODE_OPTIONS='' node --test scripts/issue-103/setup.test.mjs`. The complete suite requires official Git network access for real patch failures; it does not install Harness. Native marker-permission tests require an ordinary non-root POSIX user. Temporary fixtures resolve aliases before use; leaf symlinks remain rejected.

### Pinned acquisition boundary

`acquirePinnedSource(upstream, baseRevision, cwd)` exclusively creates the destination; existing directories (even empty ones) and files reject without adoption. Its caller owns cleanup after creation, including failure; `prepare()` retains its existing marker-based cleanup authority. Only `readSeries()`-admitted official inputs reach this helper from full preparation. Baseline and candidate have independent `.git` directories, without alternates, shared caches, partial-clone filters, mutable ref targets, retries or fallback. Git retains its existing 120-second command bound; depth one is not a latency guarantee.

Failed trusted Git commands add at most 1024 characters of request context and 256 of the original message, using the existing diagnostic redactor and omitting native URL userinfo arguments. The original cause and enumerable fields remain available; absent timeout streams are not fabricated. This is bounded attribution, not universal redaction of arbitrary arguments or retained error fields.

`NODE_OPTIONS='' node --test scripts/issue-103/acquisition.test.mjs` uses only a native local `file://` three-commit graph: exact middle HEAD/tree/bytes/modes, shallow boundary, independent repositories, exact origins, occupied destinations and unavailable pins. It does not provision Node or a package manager. Official source preparation, patch failures and all readmission assertions still require separately authorized fresh gates; these local checks do not establish official source identities or runtime compatibility.

## Read-only private environment inspection

`await inspectPrivatePnpmEnvironment(options)` in `scripts/private-pnpm.mjs` reconstructs the creator's `{ binDirectory, nodeBin, environment }` from already-created fixed state, without creating, repairing, provisioning or executing anything. It checks canonical caller-owned temporaryRoot, package-manager root, every fixed directory and an empty regular single-link npmrc; missing, wrong-type, linked or group/world-writable fixed paths reject, parents first. Any private `bin/node` entry rejects. Links below cache directories remain allowed; their payloads are not authenticated.

This assumes ordinary POSIX ownership, trusted caller configuration and stable filesystem state, not concurrent attackers or a sandbox. Creation still inherits the caller's umask; use restrictive state (e.g. umask 077). Inspection does not guarantee writability or executability. `nodeBin`, explicit `nodeBinDir`, inherited PATH and other environment values remain caller configuration, **not executable or ambient-authority admission**. Never log the returned ambient environment. Private Node-shadow refusal is inspection-only; existing creation/provisioning callers are unchanged.

Chain: #309 → **📍 environment inspection** → installed Node/Corepack observation → complete Corepack runtime → real fallback → runner. Work/private/tmp, receipts, source/Git identities, pnpm profiles/launchers and runtime authorization remain later owners. This operation grants no Harness compatibility or full-runtime acceptance. Rollback removes this operation, its tests/docs and private recipe extraction only.

Native filesystem gate: `NODE_OPTIONS='' NODE_DISABLE_COMPILE_CACHE=1 yarn exec vitest run test/private-pnpm-inspection.test.ts test/private-pnpm.test.ts`. Tests use Vitest's default forks pool, scope and restore umask 077, compare controlled configuration only, verify pre-restoration state on success/rejection and await owned-root cleanup.

## Mandatory exact-Node fixture CI prerequisite

The existing `quality` job runs `node-fixture.test.mjs` natively on exact Node 24.16.0 after immutable Yarn installation and before restoring `${{ matrix.node }}`. Vitest does not discover this standalone `.mjs` suite. The matrix remains 22.13.0/24 on Ubuntu 24.04; no jobs or existing gates are removed.

Local equivalent, with Node 24.16.0 active: `NODE_OPTIONS='' NODE_DISABLE_COMPILE_CACHE=1 node --test --test-reporter=tap --test-timeout=300000 scripts/issue-103/node-fixture.test.mjs`. TAP is explicit, compile caching is disabled and the native test timeout is 300 seconds (inside the existing 60-minute CI job bound). The strict workflow policy binds the command, reviewed action SHA, exact Node input and action/command interleaving; omitted, conditional, reordered or failure-masked gates reject.

This adds Linux fixture-native coverage only, not installed-runtime admission, source/Harness compatibility or macOS evidence. Cumulative macOS verification remains pending. Chain: #310 environment inspection → **📍 exact-Node fixture CI** → installed Node/Corepack observation → complete runtime admission. Rollback removes only this CI insertion and its policy/tests/docs delta; the completed fixture is unchanged.

## Read-only source readmission

`await inspectPreparedSource(work)` (exported by `prepare-harness.mjs`) returns `{ work, identity }` only after admitting both complete sources against current HEAD-bound inputs. It never prepares, provisions, repairs or writes the work/index. The closed current-prefix manifest SHA256 `a845fb6fdfbdf7a45802881b854dd7a28454c1503e5fb39c649a61743e392aba` is paired with candidate tree `e3258a342b4c2fbbe250baa86369de6a8c6fc2ac`; mismatches reject, never auto-update. The mutable receipt is an observation, not source authority.

For readmission, prepare with a restrictive caller umask, e.g. `(umask 077; NODE_OPTIONS='' node scripts/issue-103/prepare-harness.mjs)`; unchanged preparation otherwise inherits caller modes. Admission requires canonical caller-owned external work, safe non-group/world-writable identity/retained-patch/source/Git control paths and no `.preparing`. Trusted read-only Git checks detached base HEADs, origins, independent trees and indexes; sequential native Git blob hashes verify all tracked bytes, modes and link text, including changes hidden by index flags. Nonignored untracked files reject. Genuine ignored dependencies/build outputs are allowed but are **not artifact-verified**. Cost is O(total tracked bytes), plus path/control checks; no speed claim is measured.

Run `NODE_OPTIONS='' node --test scripts/issue-103/prepared-source.test.mjs`. Fresh official preparation is mandatory, not a skipped or fabricated prerequisite. Tests mutate only their owned temporary work, restore serially and remove it afterward; normal POSIX ownership and canonicalized temporary aliases apply.

### Isolated Node test fixture

`createNodeFixture()` in `scripts/issue-103/node-fixture.mjs` returns `{ prefix, nodeBin, run, dispose }`. It copies the currently executing Node 24.16.0 and only installed Corepack/npm trees below a unique caller-owned 0700 home prefix after rejecting unsafe ancestry. It verifies original/copy bytes and internal link text, recreates standard bin links and normalizes only copied modes. This trusts installed payloads; it does **not** authenticate a new Node distribution or repair the unsafe shared installation.

Await every `run(args, { cwd, timeout })` (maximum 300 seconds, 1 MiB output), then `await dispose()` in caller cleanup. Direct fixture commands use prefix-owned HOME and temporary paths with `NODE_DISABLE_COMPILE_CACHE=1`, including Corepack's opt-in call. The unchanged provisioner constructs its own environment: compile caching is allowed below the owned work root's `private/tmp`. Trusted Git instead sets HOME/XDG to `/nonexistent` and drops temporary variables; not every descendant inherits the fixture environment. Disposal closes admission and joins bounded children before deleting the prefix; failed construction also removes it. Tests set umask 077 and register restoration before preparation. Source tests prepare once through the copied Node's official CLI; their named source-only inspector still runs from parent Node, preserving all 56 child cases and separately owned source-root cleanup. Run `NODE_OPTIONS='' node --test scripts/issue-103/node-fixture.test.mjs scripts/issue-103/prepared-source.test.mjs`; lifecycle faults are explicitly labeled, mutate only owned paths, and include native copy/spawn failures. npm is retained for future fallback tests, not fallback-selection proof.

This assumes a trusted caller, stable filesystem and trusted Git database/configuration, not hostile concurrent writers. **Returned Node/Git/pnpm/launcher observations are not executable admission.** Nested private-environment write-target checks, launcher validation and actual command invocation belong to the next runner unit; this inspector never calls `privateEnvironment()`. These source-only receipts and tests are not Harness build, host compatibility, installability, apply-capability or publication proof; default runtime and active GUI remain unchanged.
