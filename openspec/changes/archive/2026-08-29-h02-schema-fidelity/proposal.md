# Proposal: Prove and Correct H-02 Schema Fidelity

## Intent

Make the pinned Harness/model receive an honest, executable `ast_explore` input contract without broad schema or host changes.

## Scope

- Bind public 0.13.0 RED and packed-candidate GREEN to the pinned Harness identity.
- Preserve `project_root` as required through MCP, Harness registry, and native model publication.
- Keep query/file, symbol/file, and call-spine cross-field failures closed.
- Retain complete normalized parity for the other 14 guarded schemas.

Out of scope: output-schema redesign, H-03 timeout ownership, H-05 lifecycle, PTC/UI, workspace authority, and apply.

## Success

Focused and exact-host gates pass, no schema silently becomes `{}`/unconstrained, cleanup remains proven, and the work unit stays at or below 400 changed lines.
