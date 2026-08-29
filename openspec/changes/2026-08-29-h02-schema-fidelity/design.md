# Design: H-02 Schema Fidelity

## Approach

1. Keep an object-rooted `ExploreInputObjectSchema` for MCP publication and default parsing.
2. Derive `ExploreInputSchema` by applying the existing three refinements.
3. Register the object schema, then parse the callback input with the refined schema before project work.
4. Extend the pinned Harness journey to retain normalized model tool schemas, compare all unaffected definitions, and exercise invalid combinations.

## Invariants

- Missing `project_root` remains protocol-invalid before execution.
- Cross-field failures become bounded tool errors through the same registered implementation.
- Successful defaults and routes do not change.
- Public/candidate comparison normalizes only the single expected `ast_explore.required` delta.
- Existing apply denial, owner-token cleanup, fixture immutability, and pinned identities remain mandatory.

## Rollback

Revert the schema split, focused tests, exact-host H-02 assertions, and roadmap/SDD records. H-01a projection and lifecycle evidence remain independent.
