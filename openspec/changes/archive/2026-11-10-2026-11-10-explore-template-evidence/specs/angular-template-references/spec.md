# Angular Template References Specification (delta)

## ADDED Requirements

### Requirement: ast_explore reports template evidence

When `ast_explore` builds reference evidence (`detail` full or context, with references included), it MUST use the same template usage collection and coverage verdict as `ast_find_references` for the same symbol. Symbol scope MUST be delegated to that collection: private component members, selector-public members (via consumer templates), `@Pipe` classes and `transform`, and `inherited_member` (`unsupported`) MUST yield the same verdict as `ast_find_references`. When coverage is not `not_applicable`, `evidence[].references` MUST add `template_coverage` and `template_reference_count`, and every item MUST carry `origin` (`compiler`, `template_external`, `template_inline`). When coverage is `not_applicable`, none of these keys MAY appear.

#### Scenario: Member used only in its template

- GIVEN an Angular component member referenced only in its template
- WHEN `ast_explore` runs with references included
- THEN the references contain a template item with `origin` `template_external` or `template_inline`, `template_reference_count` is at least 1, and `template_coverage.status` is `completed`

#### Scenario: Verdict parity with find_references

- GIVEN a selector-public `@Input`, a `@Pipe` class, and an inherited member
- WHEN `ast_explore` and `ast_find_references` run for each
- THEN `template_coverage` and `template_reference_count` are deep-equal between the two tools

#### Scenario: Non-Angular output unchanged

- GIVEN a non-Angular project, or an Angular symbol with coverage `not_applicable`
- WHEN `ast_explore` runs, directly or in a batch
- THEN the output is deep-equal to the pre-change output and has no `origin`, `template_coverage`, or `template_reference_count` key

### Requirement: Shared reference_limit for merged references

`reference_limit` MUST bound the merged list of TypeScript and template items, using the same merged pagination as `ast_find_references`, even though the frozen input description says "compiler references". `origin` MUST distinguish item kinds. `reference_count` MUST count TypeScript items only. When the merged list exceeds the limit, the existing reference-limit omission MUST apply.

#### Scenario: Limit applies to the merged list

- GIVEN 3 TypeScript and 4 template references and `reference_limit` 5
- WHEN `ast_explore` runs
- THEN 5 items are returned in `file:line:col` order, `template_reference_count` is 4, and the reference-limit omission is present

### Requirement: Incomplete template coverage is explicit

Any `template_coverage.status` other than `completed` (`unfinished` or `unsupported`, with its reason) MUST be reported and MUST set `completeness.evidence_complete` to false. If the template usage collection step fails (a non-cooperative error) while the TypeScript reference collection succeeded, `ast_explore` MUST keep the TypeScript references, report `template_coverage` `{ status: "unfinished", reason: "template_unresolved" }`, emit the `template_coverage_incomplete` omission, and MUST NOT report `references_unresolved`. If the TypeScript reference collection itself fails, `ast_explore` MUST report `references_unresolved` as before, MUST NOT report `template_coverage` or `template_coverage_incomplete` for that selector, and `evidence_complete` MUST be false. Cooperative cancellation and deadline errors MUST keep propagating in both cases.

#### Scenario: Non-completed statuses

- GIVEN symbols whose coverage is `compiler_missing`, `template_parse_error`, `size_exceeded`, `work_exhausted`, and `inherited_member`
- WHEN `ast_explore` runs for each
- THEN each reports that status and reason and `evidence_complete` is false

#### Scenario: Template path failure

- GIVEN the template usage collection step throws a non-cooperative error and TypeScript reference collection succeeds
- WHEN `ast_explore` runs
- THEN TypeScript references are still returned, coverage is `unfinished` / `template_unresolved`, `template_coverage_incomplete` is emitted, and no `references_unresolved` is reported

#### Scenario: TypeScript reference collection failure

- GIVEN the TypeScript reference collection itself fails with a non-cooperative error
- WHEN `ast_explore` runs
- THEN `references_unresolved` is reported as today, there is no `template_coverage` and no `template_coverage_incomplete` for that selector, and `evidence_complete` is false

#### Scenario: Cooperative errors propagate

- GIVEN a cancellation or deadline error raised in either collection step
- WHEN `ast_explore` runs
- THEN the error propagates and is not converted into an omission or coverage verdict

### Requirement: Template evidence isolation and frozen contract

Template usages MUST NOT enter `ast_get_impact`, `ast_find_test_candidates`, or `ast_explore` call spines. Tool descriptions and input schemas MUST NOT change and no input MAY be added. Direct and batch `ast_explore` for an Angular request MUST return equal fields, omissions, and completeness, and the TOON-decoded batch result MUST equal the JSON result.

#### Scenario: Isolation

- GIVEN a member with template usages
- WHEN impact, test-candidate, and call-spine evidence is built
- THEN none contains template items

#### Scenario: Batch parity

- GIVEN an Angular explore request
- WHEN run directly and in a batch (JSON and TOON)
- THEN fields, omissions, and completeness are equal after decoding

### Requirement: Explore template latency threshold

For `detail=full` and `limit=20` on a 500-component fixture with 20 `@Input` members, the added p95 wall time versus the non-Angular baseline MUST be at most 2 s. On a 2000-component fixture every request MUST finish with a typed result. If either check fails, a template read cache MUST be filed as a follow-up issue before release; the cache itself is out of scope.

#### Scenario: Thresholds measured

- GIVEN the 500- and 2000-component fixtures
- WHEN the measurement runs
- THEN the added p95 is at most 2 s and the 2000-component requests all return typed results, or a cache follow-up issue exists

### Requirement: Docs and skill describe explore template evidence

The skill (`SKILL.md`, `operations.md`), README, and CHANGELOG MUST state the shared limit rule, the new fields, the `template_coverage_incomplete` omission, and that paging template items is done through `ast_find_references`. The skill version MUST exceed 4.8.0 with its predecessor recorded in `releases.json`. The documentation assertions in `test/angular-docs.test.ts` (currently `/ast_explore[^\n]*TypeScript-only/i` and `/issue #380/`) MUST stop asserting the TypeScript-only limit once the docs describe explore template evidence; this is a documentation obligation with no coupling to the schema digest change.

#### Scenario: Docs present

- GIVEN the docs slice
- WHEN the skill, README, and CHANGELOG are read
- THEN each obligation above is stated and the docs test passes
