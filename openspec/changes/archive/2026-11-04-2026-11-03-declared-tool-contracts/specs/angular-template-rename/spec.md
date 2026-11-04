# Delta for Angular Template Rename

## MODIFIED Requirements

### Requirement: Rename states TypeScript-only diagnostics

The `rename_symbol` tool description MUST state that template writes occur and that post-apply diagnostics are TypeScript-only. The requirement is met by the declared contract for `ast_rename_symbol` (see `declared-tool-contracts`); the previous deferral note is removed.

(Previously: the tool-description clause was deferred because the `dsh-adapter` smoke froze tool descriptions against public 0.13.0.)

#### Scenario: Tool description

- GIVEN the tool inventory
- WHEN the `ast_rename_symbol` description is read
- THEN it is exactly: `Prepares an exact hash-bound rename plan without writing. Review the preview and apply its operation_id with ast_apply_operation. The plan also rewrites external Angular templates hash-bound to the workspace snapshot; diagnostics stay TypeScript-only.`
- AND this string is digest-sensitive: it MUST match the fixture declaration and the re-baselined inventory pins byte for byte
