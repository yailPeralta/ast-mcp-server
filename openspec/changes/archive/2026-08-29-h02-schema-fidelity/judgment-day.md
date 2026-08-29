# Judgment Day: H-02 Schema Fidelity

## Round 1 target

- Base: `24a67d9de6adca915b75d716512731565fbb55a1`
- Target: `9ee854b6fd02ca35d96dab1bd83c40f61a6e8058`
- Judges: two blind read-only reviews; both returned `CHANGES_REQUIRED`.

## Frozen ledger

| ID   | Severity | Agreement | Finding                                                                            | Disposition                                                           |
| ---- | -------- | --------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| JD-1 | ERROR    | 2/2       | Harness exercised only one of three required invalid combinations.                 | Add the complete registry matrix.                                     |
| JD-2 | ERROR    | 2/2       | Registry/native parity could not detect nested schema degradation from direct MCP. | Bind direct MCP hash and nested call-spine oracle to registry/native. |
| JD-3 | WARNING  | 2/2       | `ast_get_impact` TOON runtime was not exercised directly.                          | Add focused TOON execution; informational under policy.               |

## Scoped re-judgment

Correction target `2cd4dd9243c4bd6e9fefd07ee09af056eb0f6e3a` closed JD-1 and JD-2. Both blind judges returned `APPROVED`; no fix-caused severe defect remained. PR #104 merged at `a31538df03cbfc1f170b86ebdb88b5cffade34dc`.
