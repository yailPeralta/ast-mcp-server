# Tasks: H-02 Schema Fidelity

## TDD work unit

- [x] 1. RED: direct `tools/list` requires `project_root`; invalid cross-field calls fail; public pinned Harness reproduces missing requirement.
- [x] 2. GREEN: publish the object schema and apply refinements inside the registered handler.
- [x] 3. REFACTOR: prove all other schemas are identical and retain bounded hashes/evidence.
- [x] 4. VERIFY: focused tests, exact A/B/C/D Harness, format, lint, typecheck, full suite, package gates.
- [x] 5. DELIVER: update roadmap/evidence, adversarial review, one issue-linked PR.

## Forecast

Estimated authored delta: 300–390 lines. One PR if the 400-line gate remains satisfied; otherwise split exact-host evidence from documentation. Rollback is limited to H-02 artifacts, `ast_explore` schema wiring/tests, and schema evidence assertions.
