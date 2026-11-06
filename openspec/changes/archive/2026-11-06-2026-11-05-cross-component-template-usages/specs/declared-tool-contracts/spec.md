# Declared Tool Contracts Specification (delta)

## MODIFIED Requirements

### Requirement: Inventory digest pins re-baselined [S5]

When any tool description changes, the three inventory digest pins (`test/fixtures/tool-inventory.json`, `scripts/registry-consumer-smoke.mjs`, `scripts/canary-local-mcp.mjs`) MUST be re-baselined to the new inventory. The canary pin MUST be computed from the canary's own guard=allow run and MUST NOT be copied from another pin. Slices S1 to S4 MUST NOT change any tool description, schema or the inventory digest. Slice S5 MUST re-baseline the `ast_find_references` description (and the `ast_rename_symbol` description if it changes) so that it states that Angular template usages include consumer templates, that `completed` covers templates inside the Project only, that incomplete coverage does not prove absence, and that template errors are not diagnosed. The exact strings are fixed in design and MUST match the fixture declaration and the three pins byte for byte.

#### Scenario: No contract change before S5

- GIVEN S1 to S4 merged
- WHEN the inventory tests, registry-consumer smoke and canary run
- THEN no digest pin changed and no declaration was added

#### Scenario: Pins consistent after the S5 description change

- GIVEN the `ast_find_references` description changed in S5
- WHEN the inventory tests, registry-consumer smoke and canary run
- THEN each pin matches its own computed digest and the declared contract matches the candidate

#### Scenario: Canary pin source

- GIVEN a new canary pin is needed
- WHEN it is produced
- THEN its value comes from the canary run with guard=allow, not from the other two pins

#### Scenario: Declaration lifecycle

- GIVEN the S5 declaration is added in the same change that alters the contract
- WHEN `PUBLIC_BASELINE_VERSION` later advances to a release containing it
- THEN the declaration is stale and must be removed
