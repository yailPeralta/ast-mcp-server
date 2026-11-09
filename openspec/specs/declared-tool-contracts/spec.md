# Declared Tool Contracts Specification

## Purpose

Replace the blanket freeze of every non-`ast_explore` tool against the public baseline in the `dsh-adapter` smoke with a declared-contract rule: intentional tool contract changes are explicit, reviewed and committed; silent drift still fails.

## Requirements

### Requirement: Undeclared tools equal the public baseline

A tool with no declaration MUST equal its public baseline counterpart on name, description and normalized (semantic) input schema. Any difference MUST fail the comparison with a message naming the tool.

#### Scenario: Silent description drift

- GIVEN `ast_find_symbols` has no declaration and its candidate description differs from the public one
- WHEN `compareToolContracts` runs
- THEN the result fails and the message names `ast_find_symbols` and the `description` field

#### Scenario: Silent schema drift

- GIVEN `ast_find_symbols` has no declaration and its candidate semantic input schema differs from the public one
- WHEN the comparison runs
- THEN the result fails and the message names `ast_find_symbols` and the `input_schema` field

#### Scenario: Undeclared tool unchanged

- GIVEN an undeclared tool whose candidate equals the public tool
- WHEN the comparison runs
- THEN that tool passes

### Requirement: Declared tools equal their declaration

A declared tool MUST equal its declaration on description and normalized input schema. A mismatch MUST fail the comparison with a message naming the tool and the mismatching field (`description` or `input_schema`).

#### Scenario: Description differs from declaration

- GIVEN `ast_rename_symbol` is declared and the candidate description differs from the declared description
- WHEN the comparison runs
- THEN the result fails naming `ast_rename_symbol` and `description`

#### Scenario: Input schema differs from declaration

- GIVEN `ast_find_references` is declared and the candidate semantic input schema differs from the declared `input_schema`
- WHEN the comparison runs
- THEN the result fails naming `ast_find_references` and `input_schema`

#### Scenario: Declared tool matches

- GIVEN a declared tool whose candidate equals its declaration and differs from public
- WHEN the comparison runs
- THEN that tool passes

### Requirement: Declarations must differ from the public baseline

A declaration equal to the public baseline tool (name, description and normalized input schema) is stale and MUST fail the comparison with a message naming the tool.

#### Scenario: Stale declaration

- GIVEN `ast_rename_symbol` is declared with a description and schema identical to the public ones
- WHEN the comparison runs
- THEN the result fails, names `ast_rename_symbol` and states the declaration is stale

### Requirement: Declarations must target valid tools

A declaration for a tool absent from the public baseline or from the candidate inventory MUST fail. A declaration for `ast_explore` MUST fail, because `ast_explore` keeps its existing RED/corrected semantics. The failure message MUST name the tool.

#### Scenario: Declaration for an unknown tool

- GIVEN the fixture declares `ast_nonexistent`
- WHEN the comparison runs
- THEN the result fails and the message names `ast_nonexistent`

#### Scenario: Declaration for a tool missing from the candidate

- GIVEN a tool exists in public and is declared, but is absent from the candidate inventory
- WHEN the comparison runs
- THEN the result fails and the message names that tool

#### Scenario: Declaration for ast_explore

- GIVEN the fixture declares `ast_explore`
- WHEN the comparison runs
- THEN the result fails naming `ast_explore`
- AND the existing RED/corrected `ast_explore` checks are unchanged

### Requirement: Comparison scope and strictness

The comparison MUST be performed over `name`, `description` and the normalized (semantic) input schema. The `additionalProperties` strictness check MUST remain in force for all tools, declared or not.

#### Scenario: Semantically equal schemas

- GIVEN a candidate schema that differs from the public one only in non-semantic raw form (for example zod 3 versus zod 4 serialization)
- WHEN the comparison runs
- THEN the schemas are treated as equal

#### Scenario: Strictness regression on a declared tool

- GIVEN a declared tool whose candidate schema loses `additionalProperties: false`
- WHEN the comparison runs
- THEN the strictness check fails even though the description matches its declaration

### Requirement: Declaration fixture shape

Declarations MUST live in `test/fixtures/declared-tool-contracts.json` with the shape `{ "baseline": "<version>", "tools": { "<name>": { "description": "<string>", "input_schema": <semantic schema form> } } }`. `baseline` MUST equal `PUBLIC_BASELINE_VERSION`; a mismatch MUST fail. An empty `tools` object MUST behave as the blanket freeze.

#### Scenario: Baseline mismatch

- GIVEN the fixture `baseline` is `0.12.0` and `PUBLIC_BASELINE_VERSION` is `0.13.0`
- WHEN the fixture is validated
- THEN validation fails stating the baseline mismatch

#### Scenario: Empty declarations

- GIVEN `tools` is `{}`
- WHEN the comparison runs
- THEN every non-`ast_explore` tool MUST equal public, matching the previous freeze

### Requirement: Declaration lifecycle

A declaration MUST be added in the same change that alters the tool contract. A declaration MUST be removed when the baseline advances to a release that already contains the change; the stale rule enforces this by failing once candidate and declaration both equal the new public tool.

#### Scenario: Baseline advances

- GIVEN `PUBLIC_BASELINE_VERSION` advances to a release containing the declared description
- WHEN the smoke runs with the declaration still present
- THEN the declaration is stale and the run fails until it is removed

### Requirement: Per-tool evidence in the smoke summary

The smoke MUST record `summary.h02.declaredContracts`, with one entry per declared tool holding the sha256 digests of its public, candidate and declared forms. It MUST keep `unaffectedSemanticSha256` for the undeclared set, projected into `summary.h02.declaredContracts.undeclaredSha256` as `{ public, candidate }`.

#### Scenario: Evidence recorded

- GIVEN a passing smoke with `ast_find_references` and `ast_rename_symbol` declared
- WHEN the summary is read
- THEN `summary.h02.declaredContracts` has an entry for each tool with public, candidate and declared sha256 values, and the candidate and declared digests are equal while the public digest differs

### Requirement: Testability and mandatory execution

The comparison logic MUST live in a pure module (`scripts/lib/declared-tool-contracts.mjs`, exporting `compareToolContracts({ publicTools, candidateTools, declared, baselineVersion })`; `public` is a reserved word, so the parameter is named `publicTools`) that is unit-testable without running the smoke. The `dsh-adapter` smoke MUST remain mandatory and MUST NOT green-skip.

#### Scenario: Unit test without the smoke

- GIVEN synthetic public, candidate and declared inputs
- WHEN `compareToolContracts` is called in a unit test
- THEN it returns the pass or fail result without launching the smoke or any server

#### Scenario: Smoke cannot skip

- GIVEN the smoke cannot obtain its public baseline or candidate
- WHEN it runs
- THEN it exits non-zero rather than reporting success

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
