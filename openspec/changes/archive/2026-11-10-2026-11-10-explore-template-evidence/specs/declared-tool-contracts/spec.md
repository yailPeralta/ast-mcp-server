# declared-tool-contracts Specification (delta)

## ADDED Requirements

### Requirement: Explore output schema change re-pins without contract drift

The `ast_explore` output schema extension MUST leave every tool description and input schema unchanged, and the `ast_find_references` JSON schema MUST stay byte-identical after the shared leaf schema extraction. Any resulting inventory digest change MUST be re-baselined in the same PR in exactly the three locations that hold `tools/list` digest literals: `test/fixtures/tool-inventory.json`, `scripts/registry-consumer-smoke.mjs`, and `scripts/canary-local-mcp.mjs`, with the canary pin (`scripts/canary-local-mcp.mjs`) computed from its own guard=allow run.

#### Scenario: Frozen inputs and descriptions

- GIVEN the change is applied
- WHEN the inventory is compared with the declared contracts
- THEN descriptions and input schemas are unchanged and `ast_find_references` output schema is byte-identical

#### Scenario: Pins consistent

- GIVEN the explore output schema gained optional fields
- WHEN inventory tests, registry smoke, and canary run
- THEN each pin matches its own computed digest
