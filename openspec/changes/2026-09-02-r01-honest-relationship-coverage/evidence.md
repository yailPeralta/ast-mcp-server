# U1–U7 Gate Evidence

This is the authoritative review path for the R-01 apply chain. It records behavior and gate evidence without claiming Judgment, strict verification, archive, merge, release, or issue closure.

## Behavior through U6

| Unit | Result                                                                                  | Authority                                                                                                         |
| ---- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| U1   | Expected RED reproduced twice: 1 failed and 28 skipped.                                 | Registered MCP rejected the false-complete incoming-call contract before production changes.                      |
| U2   | GREEN: 3 focused coverage tests and 48 impact tests.                                    | Ordered coverage statuses, total registry, and one bounded work tracker fail closed.                              |
| U3   | GREEN: 12 call-focused tests; 50 impact, 10 relationship, and 8 call-spine regressions. | Exact scoped functions, methods, constructors, and overloads replaced the U1 false negative.                      |
| U4   | GREEN: 5 containment-focused tests and 70 service regressions.                          | Only direct compiler-owned named containment is authoritative.                                                    |
| U5   | GREEN: 21 candidate-focused tests plus 17 schema/catalog/budget tests.                  | Public coverage/work is additive; candidates freeze six incoming kinds and exclude `contains`.                    |
| U6   | GREEN: 134 focused and 983 full/supervised tests.                                       | Seven-kind positives/negatives, mixed kinds, ordering, bounds/work, candidate rejection, and cancellation passed. |

Strict TDD history is cumulative in `apply-progress.json`: all behavior IDs are refactored and the active RED set is empty.

## Public cutover

- Coverage is ordered by public kind, effective direction, and endpoint class. Only `completed` and `not_applicable` authorize completeness.
- Exact calls remain conservative: ambiguous, dynamic, unresolved, or potentially relevant unknown incoming sites are `unfinished`, never guessed.
- `contains` is module→top-level named declaration or named declaration→direct named child; incoming is the inverse. Statements, parameters, anonymous/transitive/runtime/heuristic/index ownership are excluded.
- Candidate discovery requests exactly incoming `reference`, `import`, `export`, `extends`, `implements`, and `call`; unsafe coverage returns `INCOMPLETE_EVIDENCE`, never `proven_empty`.
- One request work budget covers traversal, producers, and probes. Exhaustion returns unfinished/incomplete data; cancellation returns `REQUEST_CANCELLED` without partial success.
- The response change is additive. Exact-shape clients must accept `coverage` and `work`; no persisted migration or index rebuild is needed. Rollback removes producers, ledger/work projection, six-kind candidate gate, docs, and tests together.

## U7 gates

### Full clean gate

| Attempt       | Result                                                        | Evidence                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1             | Exit 1 at `yarn format:check`; the chain stopped before lint. | Prettier reported `openspec/changes/2026-09-02-r01-honest-relationship-coverage/evidence.md` and `Code style issues found in the above file. Run Prettier with --write to fix.`                                                                                                                                                           |
| Sanitation    | Targeted only `evidence.md`; exit 0.                          | `yarn prettier --write openspec/changes/2026-09-02-r01-honest-relationship-coverage/evidence.md` completed in 32 ms. SHA-256 remained identical for the other five U7-authored docs; only `evidence.md` changed from `c2231136…` to `9309383…`.                                                                                           |
| 2, sole retry | Exit 0 in 151 seconds.                                        | Exact full chain passed format, lint, typecheck, 75 files/981 tests plus 1 file/2 supervised tests, build, MCP/lifecycle/CLI/error smokes, and package smoke. MCP reported 16 unguarded tools; package smoke proved `ast-mcp-server@0.13.1`, Node `>=22.13.0`, six installed/idempotent targets, and all declared package/runtime checks. |

### Pinned Harness gate

- Exact command exited 0 in 170 seconds: `env -u GIT_PAGER bash -lc 'yarn vitest run test/dsh-adapter.test.ts test/tool-catalog.test.ts && yarn test:dsh-adapter'`.
- Vitest passed 2 files/23 tests. Adapter smoke returned phases `a`, `b`, `c`, `h03`, `h05`, and `d` all `ok` with cleanup `ok`.
- Authenticated identity was revision `cd5ef8148158c3a752a658978873241fdf8e2bbc`, tag `dsh-v0.1.2-alpha.1`, CLI/MCP client `0.1.2-alpha.1`, and AST package `0.13.1`.
- Guarded catalogs were exactly `[15, 0, 15]`; the rendered 15-name catalogs excluded `mcp__ast__ast_apply_operation`. The probe source and passing adapter assertions require direct apply rejection code `UNKNOWN_TOOL`.

### Pinned Harness snapshot

- Path/revision: `/home/yail/.local/share/dsh-oauth-cutover/cd5ef8148158c3a752a658978873241fdf8e2bbc/host` / `cd5ef8148158c3a752a658978873241fdf8e2bbc`.
- Package identity: `@deepseek-ai/dsh-root@0.1.2-alpha.1`; Git metadata absent.
- The first handoff reported `sha256:82c77b084232b8a0e0f902cd68e96cad9b7b55fff272865f2b82f72c16522dcd` and matching inventory counts but omitted its digest algorithm. That incomplete evidence remains disclosed here and is superseded, not retroactively treated as reproducible.
- A preliminary invocation from the pinned checkout exited 1 before tests because that repository declares pnpm. It preceded the fresh pair below, made no Harness write, and is not the task 7.3 rerun. The exact command then ran from this repository between the fresh canonical snapshots and exited 0.
- Canonical BEFORE and AFTER were identical: `sha256:e9be86fb8ef58a82d9e9b5ef16f1f4ed900e0eecd142d95591e16384d46e40cc`; 91,215 entries, 73,083 regular files, 11,927 directories, 6,205 symlinks, 1,568,220,487 regular-file bytes, and 0 other entries.
- Algorithm: recursively enumerate every entry beneath the pinned root without following symlinks; represent project-relative paths as raw POSIX bytes; sort by those raw bytes; for each entry hash an unsigned 64-bit big-endian length plus relative-path bytes, then the same framing for the exact type bytes (`file`, `directory`, `symlink`, or `other`); for a regular file additionally hash framed raw content, and for a symlink framed raw link-target bytes. Directories and other entries have no payload. Count entries/types and regular bytes in the same pass. The root itself, timestamps, permissions, ownership, inode data, and other mutable metadata are excluded.
- Exact ephemeral inline Python source, executed from this repository and never written into the Harness tree, was identical for BEFORE and AFTER:

```python
import hashlib
import os
import stat
import struct

ROOT = os.fsencode('/home/yail/.local/share/dsh-oauth-cutover/cd5ef8148158c3a752a658978873241fdf8e2bbc/host')
U64 = struct.Struct('>Q')

def frame(value):
    return U64.pack(len(value)) + value

def enumerate_entries(root):
    entries = []
    stack = [(root, b'')]
    while stack:
        absolute_dir, relative_dir = stack.pop()
        with os.scandir(absolute_dir) as iterator:
            children = list(iterator)
        for child in children:
            name = child.name
            relative = name if not relative_dir else relative_dir + b'/' + name
            mode = child.stat(follow_symlinks=False).st_mode
            if stat.S_ISREG(mode):
                entry_type = b'file'
            elif stat.S_ISDIR(mode):
                entry_type = b'directory'
                stack.append((child.path, relative))
            elif stat.S_ISLNK(mode):
                entry_type = b'symlink'
            else:
                entry_type = b'other'
            entries.append((relative, child.path, entry_type))
    entries.sort(key=lambda entry: entry[0])
    return entries

digest = hashlib.sha256()
counts = {'entries': 0, 'files': 0, 'directories': 0, 'symlinks': 0, 'regular_bytes': 0, 'other': 0}
for relative, absolute, entry_type in enumerate_entries(ROOT):
    digest.update(frame(relative))
    digest.update(frame(entry_type))
    counts['entries'] += 1
    if entry_type == b'file':
        with open(absolute, 'rb') as stream:
            content = stream.read()
        digest.update(frame(content))
        counts['files'] += 1
        counts['regular_bytes'] += len(content)
    elif entry_type == b'directory':
        counts['directories'] += 1
    elif entry_type == b'symlink':
        target = os.readlink(absolute)
        digest.update(frame(target))
        counts['symlinks'] += 1
    else:
        counts['other'] += 1

print('sha256:' + digest.hexdigest())
for key in ('entries', 'files', 'directories', 'symlinks', 'regular_bytes', 'other'):
    print(f'{key}={counts[key]}')
```

## Progress and next authority

U7 tasks 7.1–7.4 are complete under the settled receipt and exact evidence revision. Apply is 23/28 with zero active RED. The next action is U8 Judgment under separate fresh authority; archive, delivery, and issue closure remain unclaimed.
