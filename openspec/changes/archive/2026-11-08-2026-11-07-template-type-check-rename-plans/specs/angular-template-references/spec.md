# Angular Template References Specification (delta)

## MODIFIED Requirements

### Requirement: Diagnostics remain TypeScript-only

`find_references` MUST NOT produce diagnostics and MUST NOT claim that template errors are or are not detected by the references result. Edit-aware diagnostic delta (`diagnostics`) MUST remain TypeScript-only, including after consumer-template rewrites. Template type checking of rename plans is provided separately by `template_diagnostics` (see `angular-template-type-check`). The `ast_find_references` description MUST drop the statement that template errors are not diagnosed and MUST NOT otherwise change its stated template-usage semantics (consumer templates included, `completed` covers templates inside the Project only, incomplete coverage does not prove absence). The exact string is fixed in design and MUST match the fixture declaration and the re-baselined inventory pins byte for byte.

(Replaces "Diagnostics remain TypeScript-only" and its two "not diagnosed" scenarios, which no longer hold for rename plans.)

#### Scenario: diagnostics field stays TypeScript-only

- GIVEN a rename that breaks only a template binding
- WHEN the plan is prepared
- THEN `diagnostics` contains no template diagnostic, and the break is reported only in `template_diagnostics`

#### Scenario: find_references makes no diagnostic claim

- GIVEN a `find_references` request
- WHEN the result is returned
- THEN it contains no diagnostics and its description does not claim template errors are not diagnosed

#### Scenario: find_references tool description before re-baseline

- GIVEN the spike, loader, worker and wiring slices (PRs 1, 2a, 2b, 3) of this change
- WHEN the `ast_find_references` description is read
- THEN it is unchanged from the current declared string

#### Scenario: find_references tool description after re-baseline

- GIVEN the docs slice of this change
- WHEN the `ast_find_references` description is read
- THEN it keeps the consumer-template, `completed` scope and incomplete-coverage statements and omits "template errors are not diagnosed"
- AND this string is digest-sensitive and matches the fixture declaration and the inventory pins byte for byte
