# ast-explore-omission-metadata Specification

## Purpose

Make omitted or non-authoritative requested evidence explicit.

## Requirements

### Requirement: Categorized bounded omissions

The system MUST classify every omitted selector/path component as `budget`, `incomplete`, or `untrusted`, with exact category/component counts, a stable bounded detail prefix, and `has_more` when summarized. Completeness MUST include omitted components, reference continuations, and spine evidence while retaining existing unresolved/truncation fields.

#### Scenario: Budget

- GIVEN valid evidence exceeds byte, record, depth, node, or edge limits
- WHEN bounded
- THEN omission is `budget` with deterministic reason and exact counts.

#### Scenario: Incomplete

- GIVEN resolution, cancellation, or traversal cannot finish
- WHEN returned
- THEN omission is `incomplete`, completeness is false, and absence is not negative evidence.

#### Scenario: Untrusted negative control

- GIVEN stale, non-compiler, unresolved, non-exact, or ambiguous evidence
- WHEN it could look relational
- THEN it is withheld as `untrusted`, never a call claim.
