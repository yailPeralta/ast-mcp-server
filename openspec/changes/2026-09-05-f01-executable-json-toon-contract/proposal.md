# Proposal: Executable JSON/TOON Contract

## Intent

Close issue #235 with retained executable evidence—not a fabricated production defect. Current registered-MCP runtime probes pass: JSON and decoded TOON are equivalent for all eligible tools. The missing invariant is a checked, complete four-tool oracle that makes future drift fail closed.

## Scope

### In Scope

- Add one deterministic registered stdio-MCP oracle and checked command/manifest for exactly `ast_search_symbols`, `ast_find_references`, `ast_get_impact`, and `ast_get_diagnostics`.
- Invoke each case sequentially with identical inputs in explicit JSON and TOON modes; validate success envelopes and canonical schemas, decode TOON losslessly, and deep-compare complete values after normalizing only `duration_ms` and `checked_at`.
- Cover empty and paginated collections, bounded/truncated results, Unicode, null versus omitted optional fields, finite numeric/boolean shapes, aggregates, and deterministic canonical hashes.
- Assert exact eligibility from registration and `tools/list`: eligible schemas expose the closed enum/default; unsupported tools omit `output_format`.

### Out of Scope

- Universal MCP `outputSchema`, issue #103, R-01/recovery, UI or Code Mode.
- Apply registration, authorization, mutation, or Harness changes.
- Production changes without executable evidence of a defect.

## Capabilities

### New Capabilities

- `executable-json-toon-contract`: Checked registered-MCP equivalence, inventory, envelope, schema, shape, and deterministic-hash requirements.

### Modified Capabilities

None.

## Approach

Legitimate RED is contract enforcement: the checked command/manifest MUST fail while the dedicated oracle is absent, omits an eligible tool, adds an unsupported tool, or lacks required cases/checks. It MUST NOT claim current behavior fails. GREEN adds the complete oracle and command; production changes are allowed only if the oracle exposes a concrete contradiction.

## Affected Areas

| Area                                        | Impact   | Description                                                |
| ------------------------------------------- | -------- | ---------------------------------------------------------- |
| `scripts/`                                  | New      | Deterministic stdio oracle and isolated fixture lifecycle. |
| `package.json`                              | Modified | Checked format-contract command.                           |
| `src/tools/catalog.ts` / registered schemas | Verified | Closed eligibility authority; no planned runtime edit.     |
| `test/result-format.test.ts`                | Verified | Existing non-finite and 10 MiB focused boundaries.         |

## Risks

| Risk                                     | Mitigation                                                      |
| ---------------------------------------- | --------------------------------------------------------------- |
| Volatile telemetry causes false failures | Closed two-field normalization; fail on every other difference. |
| Over-normalization hides drift           | Compare complete normalized objects and stable hashes.          |
| Ambient state causes nondeterminism      | Isolated temporary project/home/cache and guaranteed cleanup.   |

## Compatibility, Verification, and Delivery

Public schemas, defaults, errors, bounds, and output vocabulary remain compatible. Verify the dedicated command plus focused presenter, catalog, and MCP integration tests. Deliver as one `type:chore`, issue-first work unit forecast at 220–320 authored changed lines (≤400); no chain.

## Rollback Plan

Remove the oracle and command as one unit. Revert production code only if evidence-driven corrections were added.

## Success Criteria

- [ ] The checked contract fails when its exact inventory or required matrix is absent/incomplete.
- [ ] All four paired executions satisfy envelope/schema checks and lossless normalized equality with deterministic hashes.
- [ ] Unsupported tools remain excluded and focused existing boundaries pass.
