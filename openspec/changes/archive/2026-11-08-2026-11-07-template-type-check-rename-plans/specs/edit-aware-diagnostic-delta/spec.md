# Edit-Aware Diagnostic Delta Specification (delta)

## MODIFIED Requirements

### Requirement: Corrected preparation authority

Preparation MUST form exact changed-text pairs before its corrected delta, then compute policy, hash, and retention from it. It MUST write no sources. When the template check ran or tried to, so the plan carries a `template_diagnostics` result, the plan hash MUST include its `status`, `reason`, `added`, `removed` and `added_errors` (hash v3), so that any change in the template delta changes the hash. A plan with no template check (non-Angular, or no template edited, so `template_diagnostics` is absent) MUST hash exactly as before (v2); v3 applies whenever `template_diagnostics` is present, including `unavailable` and `unfinished` results. Existing cancellation, freshness, hash-binding, cleanup, and receipt invariants MUST hold. The TypeScript delta and `allow_new_errors` meaning MUST be unchanged.

#### Scenario: Dual-purpose RED

- GIVEN an edit replaces an in-body TS2322 with the same identity and harmlessly shifts an unrelated TS2322
- WHEN preparation defaults `allow_new_errors=false` and apply is attempted
- THEN exactly the replacement error MUST be added and block apply; the unrelated error MUST remain continuous and disk unchanged

#### Scenario: Template delta changes the plan hash

- GIVEN two prepares of the same edits whose `template_diagnostics` differ (for example `completed` with one added error versus `unfinished` with reason `deadline`)
- WHEN their plan hashes are compared
- THEN the hashes differ

#### Scenario: Equal template delta, equal hash

- GIVEN two hash inputs with identical edits and identical `template_diagnostics`, and with the same `operation_id`, `created_at` and all other fields (these two are random per prepare and MUST be fixed for the comparison)
- WHEN their plan hashes are compared
- THEN the hashes are equal

#### Scenario: Plan without template check hashes as before (v2)

- GIVEN a non-Angular project or a plan that edits no template (`template_diagnostics` absent)
- WHEN the plan hash is computed
- THEN it equals the v2 hash produced before this change

#### Scenario: Preparation writes no sources

- GIVEN a prepare that ran the template check
- WHEN it completes
- THEN no source or template file was written
