# ast-explore-omission-metadata Specification (delta)

## ADDED Requirements

### Requirement: Template coverage omission

For each selector whose `template_coverage.status` is not `completed`, the system MUST emit one omission with reason `template_coverage_incomplete`, category `incomplete`, component `references`. The reason MUST be a valid output omission reason and MUST set `completeness.evidence_complete` and `complete` to false. The omission MUST be added outside cluster trimming so it survives `byte_limit` trimming, including when the evidence block is dropped. A `completed` or `not_applicable` verdict MUST NOT emit it.

#### Scenario: Incomplete coverage

- GIVEN a symbol with coverage `unfinished` / `template_parse_error`
- WHEN `ast_explore` runs
- THEN one `template_coverage_incomplete` omission exists and `evidence_complete` is false

#### Scenario: Survives byte_limit trimming

- GIVEN incomplete coverage and a `byte_limit` that drops the references block
- WHEN `ast_explore` runs
- THEN the incomplete-coverage omission is counted in `omissions.total` and `omissions.counts` (keyed by category and component) and `evidence_complete` is false; `omissions.details` is cut by the detail limit, so `template_coverage_incomplete` appears in `details` only when the detail limit leaves room

#### Scenario: Completed coverage

- GIVEN coverage `completed` or `not_applicable`
- WHEN `ast_explore` runs
- THEN no `template_coverage_incomplete` omission is emitted
