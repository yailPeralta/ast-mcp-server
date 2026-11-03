# Proposal: Angular template references

Issue: #370 (https://github.com/yailPeralta/ast-mcp-server/issues/370)
Exploration: `exploration.md` (Engram `sdd/2026-11-03-angular-template-references/explore`)

## Intent

`find_references` and `rename_symbol` ignore Angular templates, so a component-member rename can silently break `.html` bindings. Agents need template usages surfaced, and renames that either update templates under hash binding or fail closed.

## Scope

### In Scope

- Angular detection plus `@angular/compiler` loaded from the user's project; feature off when absent or out of range.
- Owning-component member usages (properties, methods, accessors, signals) in external `templateUrl` and inline `template:` literals, including control flow, `@let`, structural directives, pipe arguments.
- `find_references` reports template usages (inline read-only).
- `rename_symbol` writes external `.html` under workspace hash plus per-file hash.

### Out of Scope

- Rename touching inline templates (blocked as unsupported).
- `get_impact` template edges (future change); `find_test_candidates` behavior.
- Pipe names, `#ref`/`let-` targets, child `@Input`/`@Output`, host bindings, computed `templateUrl`, `styleUrls`, template diagnostics.
- Vue, Svelte (separate changes); PHP/tree-sitter (rejected).

## Capabilities

### New Capabilities

- `angular-template-references`: detection, compiler loading/version gate, template location, usage extraction, shadowing, bounded work, completeness, `find_references` contract.
- `angular-template-rename`: hash-bound `.html` edits in prepare/apply, inline-template and ambiguity blocks.
- `template-workspace-freshness`: template files in workspace hash and watcher invalidation; byte-identical hash for non-Angular projects.

### Modified Capabilities

- `external-writer-safe-apply`: operation invariants cover non-compiler template files (postimage ownership, rollback, receipts).

## Approach

Exploration approach 1: one deep module `src/services/angular-templates.ts`; additive seams in `references.ts`, `operations.ts`, `workspace.ts`.

Completeness: unresolved/unparsable template, unsafe path, out-of-range compiler, or exhausted bound sets template coverage `unfinished` and blocks rename (`INCOMPLETE_EVIDENCE`). Never claims proven absence.

## Affected Areas

| Area                                                                | Impact                      |
| ------------------------------------------------------------------- | --------------------------- |
| `src/services/angular-templates.ts`                                 | New                         |
| `src/services/{references,operations,workspace,project-watcher}.ts` | Modified                    |
| `src/tools/{find_references,rename_symbol,operation-schema}.ts`     | Modified, additive          |
| `test/fixtures/tool-inventory.json`, `package.json`                 | Re-baselined; optional peer |
| `skills/structural-code-editing/`                                   | Docs                        |

## Risks

| Risk                         | Likelihood | Mitigation                                      |
| ---------------------------- | ---------- | ----------------------------------------------- |
| Compiler API drift           | Med        | Feature detection, tested range, fixture matrix |
| Shadowing mis-rename         | Med        | Ambiguity blocks                                |
| Hash change hits non-Angular | Low        | Byte-identity regression test                   |
| Template errors undetected   | High       | Diagnostics TS-only, stated in output/docs      |
| Inventory/TOON drift         | Med        | Deliberate re-baseline, parity tests            |

## Rollback Plan

Unresolvable Angular disables the feature. Schema fields are additive; revert units in reverse order. Prepared plans with `.html` files fail closed on hash mismatch.

## Dependencies

- `@angular/compiler` optional peer; dev-only for tests. Repo `engines` unchanged. Check `test/dependency-policy.test.ts` and package smoke.

## Review Workload Forecast

Budget 800 lines, `auto-chain`. Total ~1,700: chain required.

| Unit | Content                                            | Est. lines |
| ---- | -------------------------------------------------- | ---------- |
| 1    | Service: loader, locator, extractor + tests        | ~550       |
| 2    | `find_references` integration, schema, TOON        | ~350       |
| 3    | Hash-bound `.html` rename, workspace hash, watcher | ~600       |
| 4    | Docs, skill, inventory, package metadata           | ~200       |

## Success Criteria

- [ ] Non-Angular projects: identical outputs and workspace hash.
- [ ] External and inline usages found with exact spans.
- [ ] `.html` rename applies; post-prepare edit yields `CONFLICT`.
- [ ] Inline, ambiguous, or incomplete cases block rename.
- [ ] `find_test_candidates` unchanged; inventory/TOON re-baselined.

## Proposal question round

Auto mode; product decisions already taken. Assumptions for review: (1) supported Angular majors are fixed in design; (2) any shadowing ambiguity blocks the whole rename, not just one usage.
