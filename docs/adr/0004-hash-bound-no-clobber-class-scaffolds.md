# ADR 0004: Create class scaffolds through absent-file operation plans

- Status: Accepted
- Date: 2026-08-03

## Context

The operation engine originally modeled only modifications to existing files. A scaffold feature needs to create one source file without weakening the established prepare, preview, diagnostic, workspace-freshness, hash-review, apply, rollback, receipt, and replay guarantees.

Using a normal overwrite-capable rename for creation is unsafe: another writer can create the target after preparation and before commit. A pre-check followed by rename has a TOCTOU window. Letting arbitrary source text enter a creation plan would also turn a narrow scaffold into a general filesystem write API.

## Decision

Extend operation plans additively with an absent-file preimage sentinel and explicit expected file state. Existing modification-plan serialization and hashes remain unchanged.

`ast_scaffold_class` is a prepare-only MCP tool. It accepts a strict, bounded structured class specification and exactly one absent project-relative `.ts` or `.tsx` target. It validates:

- target path containment and lexical/canonical parent safety;
- target absence and non-symbolic parents;
- identifiers and duplicate members/parameters;
- bounded imports, heritage, decorators, types, initializers, and documentation;
- raw TypeScript fragments by parsing them in their expected declaration positions;
- at least one method and initialized properties when no definite-assignment field exists.

The scaffold is built in memory with ts-morph. Generated method bodies contain only `throw new Error("Not implemented: Class.method")`. The candidate file is verified structurally before an operation plan is created. New diagnostics block preparation unless the caller explicitly reviews `allow_new_errors: true`.

Apply stages exact bytes in the target directory with exclusive creation, flushes the staged file, then atomically links it to the absent target. Existing targets fail with `FILE_ALREADY_EXISTS`; there is no overwrite-capable fallback. The staging entry is removed after commit and the containing directory is flushed best-effort.

Rollback for creation deletes the target only when its bytes still match the reviewed postimage. Otherwise it reports conflict and preserves external work. Replay recovers an applied receipt only when the complete post-workspace fingerprint matches exactly.

## Consequences

### Positive

- Scaffolds use the same review coordinates and freshness checks as existing AST edits.
- Creation cannot clobber a concurrently created target.
- Persistent CLI plans, receipts, preview retrieval, idempotent replay, and operation bounds remain shared infrastructure.
- Pending method selectors are directly usable by `ast_replace_symbol_body` after apply.
- The operation model can safely distinguish absent and present preimages without changing old plan hashes.

### Negative

- Atomic hard-link commit requires source and target to share a filesystem and depends on local filesystem semantics.
- The feature creates only one structured class file; it is intentionally not an arbitrary code generator.
- Constructor bodies are empty by design, so derived constructors may require explicit reviewed diagnostics and a later body-capable feature.
- Directory flush is best-effort because Node and filesystems vary in directory fsync support.

## Alternatives considered

### Write the target directly with `open("wx")`

Rejected. It avoids overwrite but exposes partially written target bytes and bypasses the existing staged apply/rollback machinery.

### Stage and rename after checking absence

Rejected. POSIX rename can replace a target created during the race window.

### Reuse a text patch tool outside operation plans

Rejected. It would lose diagnostics, review hashes, complete workspace freshness, receipts, replay, and shared locking.

### General arbitrary file creation

Rejected. Its schema and threat surface are much broader than the validated class scaffold required here.
