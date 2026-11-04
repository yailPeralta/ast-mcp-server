# Delta for Angular Template References

## MODIFIED Requirements

### Requirement: Diagnostics remain TypeScript-only

Edit-aware diagnostic delta MUST remain TypeScript-only. Tool descriptions and docs MUST state that template errors are not detected. The tool-description clause is met by the declared contract for `ast_find_references` (see `declared-tool-contracts`); the previous deferral note is removed.

(Previously: the tool-description clause was deferred because the `dsh-adapter` smoke froze tool descriptions against public 0.13.0.)

#### Scenario: Template breakage not diagnosed

- GIVEN an edit that breaks only a template binding
- WHEN diagnostics delta is evaluated
- THEN no template diagnostic is produced and the limitation is stated

#### Scenario: find_references tool description

- GIVEN the tool inventory
- WHEN the `ast_find_references` description is read
- THEN it is exactly: `Finds type-resolved references and returns bounded project-relative locations, including declaration impact by default. When @angular/compiler resolves, it also reports Angular template usages tagged by origin with a template_coverage verdict; incomplete coverage does not prove absence, and template errors are not diagnosed.`
- AND this string is digest-sensitive: it MUST match the fixture declaration and the re-baselined inventory pins byte for byte
