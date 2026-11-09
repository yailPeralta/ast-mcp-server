# Declared Tool Contracts Specification (delta)

## MODIFIED Requirements

### Requirement: Inventory digest pins re-baselined

When any tool description or input schema changes, the three inventory digest pins (`test/fixtures/tool-inventory.json`, `scripts/registry-consumer-smoke.mjs`, `scripts/canary-local-mcp.mjs`) MUST be re-baselined to the new inventory. The canary pin MUST be computed from the canary's own guard=allow run and MUST NOT be copied from another pin. The spike, loader and worker slices MUST NOT change any tool description, schema or the inventory digest. The wiring slice that adds the optional `block_on_template_errors` input and the rename-only `template_diagnostics` output (through a rename-specific output schema; the `scaffold_class` and `replace_symbol_body` contracts MUST remain unchanged) MAY change those schemas and MUST re-baseline, in the same slice, the declared-contracts fixture plus the inventory (`tools_list_sha256`), registry-smoke and canary digest pins. The docs slice re-pins again for the description wording and MUST re-baseline the `ast_rename_symbol` and `ast_find_references` descriptions so that they no longer state that diagnostics are TypeScript-only or that template errors are not diagnosed, and so that `ast_rename_symbol` states that template diagnostics are reported separately with a typed status. The statements previously required of `ast_find_references` (consumer templates included, `completed` covers templates inside the Project only, incomplete coverage does not prove absence) MUST be kept. The exact strings are fixed in design and MUST match the fixture declaration and the three pins byte for byte.

#### Scenario: No contract change before the wiring slice

- GIVEN the spike, loader and worker slices merged (before the wiring slice)
- WHEN the inventory tests, registry-consumer smoke and canary run
- THEN no digest pin changed and no description was altered

#### Scenario: Optional input added with its declaration

- GIVEN the wiring slice adds `block_on_template_errors` and the rename-only `template_diagnostics` output
- WHEN the comparison runs
- THEN the declared `input_schema` contains the optional boolean and equals the candidate, `additionalProperties: false` still holds, the fixture and the three digest pins are re-baselined in that slice, and the `scaffold_class` and `replace_symbol_body` contracts are unchanged

#### Scenario: Pins consistent after the description change

- GIVEN the `ast_find_references` and `ast_rename_symbol` descriptions changed in the docs slice
- WHEN the inventory tests, registry-consumer smoke and canary run
- THEN each pin matches its own computed digest and the declared contract matches the candidate

#### Scenario: Descriptions drop the TypeScript-only wording

- GIVEN the re-baselined inventory
- WHEN the `ast_rename_symbol` and `ast_find_references` descriptions are read
- THEN neither states that diagnostics are TypeScript-only without qualification nor that template errors are not diagnosed

#### Scenario: Canary pin source

- GIVEN a new canary pin is needed
- WHEN it is produced
- THEN its value comes from the canary run with guard=allow, not from the other two pins

#### Scenario: Declaration lifecycle

- GIVEN the declaration is added in the same change that alters the contract
- WHEN `PUBLIC_BASELINE_VERSION` later advances to a release containing it
- THEN the declaration is stale and must be removed
