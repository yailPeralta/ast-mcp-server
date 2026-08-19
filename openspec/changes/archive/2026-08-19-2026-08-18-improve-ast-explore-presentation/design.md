# Design: Improve `ast_explore` Presentation

## Technical Approach

Keep discovery, planning, and transport separate:

```text
registered ast_explore handler -> context-builder -> compiler call projector
                                           |-> call-spine planner
                                           `-> explore-presentation -> JSON/TOON
```

`context-builder` retains routing, ranking, evidence, freshness, and cancellation. `relationships` adds bounded live call projection; pure planners return one result. No persistence, runtime inference, generic-reference relabeling, public impact expansion, mutation, or multi-language/index work is introduced.

The remediation separates deterministic tracked evidence from volatile observations; product semantics stay unchanged. The `.mjs` entrypoint is outside active tsconfigs, so its mapping used disclosed textual inspection.

## Architecture Decisions

| Question              | Tradeoff                                                                    | Decision and rationale                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Presentation policy   | Inline is smaller but couples compiler work to serialization.               | Pure `explore-presentation` owns cluster variants, omission aggregation, selector fallback, and byte planning.                             |
| Call representation   | Relabeled references are false; a persisted graph expands scope.            | Project only compiler-resolved invocation syntax, then plan bounded static spines.                                                         |
| Batch execution       | A second handler can drift.                                                 | Allowlist `ast_explore`; reuse MCP registration, root injection, and final-only TOON encoding.                                             |
| Benchmark persistence | One report is simple but volatile fields make tracked bytes non-convergent. | Project explicit deterministic schema v4 and volatile observation schema v1. Never fix timestamps, round timings, or compare semantically. |

## Exact Call, Budget, and Public Contracts

Calls are checker-resolved call/new/tagged-template sites after wrapper normalization. Accept one project-symbol endpoint; ambiguous, dynamic, callback, import, type, generic-reference, non-exact, or stale evidence is `untrusted`. The innermost symbol is caller.

Layer-ordered BFS emits caller-to-callee paths, selects lexicographically among shortest paths, forbids repeated endpoints, and exposes every bound. Only fresh, authoritative, complete discovery proves emptiness.

Optional exact-route `call_spines` defaults/caps at `3/100/200` and `32/1000/5000`; absence performs no call work. `omission_detail_limit` is 20, maximum 100. `omissions` has exact sorted counts and stable bounded `budget|incomplete|untrusted` details. Only whole ranked components are admitted; selector fallback advances consumed logical records. Canonical UTF-8 JSON fixed-point accounting guarantees `used_bytes <= max_bytes`; any omission, reference continuation, or incomplete spine makes evidence incomplete.

Benchmark contracts:

| Artifact                                                                        | Contract                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--output` / `benchmark/results/self-agent-workflows.json`                      | Tracked schema v4 allowlists methodology, static counts, non-timing index outcomes, impact/scenario and workflow evidence, and six gates; excludes timestamp, Node version, and timings. |
| `--observations-output` / `benchmark/results/runtime/self-agent-workflows.json` | Ignored schema v1 records timestamp, Node version, candidate evidence path/SHA-256, raw timings/durations, and gate outcomes.                                                            |

Focused exports cover parsing, both projectors, gates, path distinctness, byte publication, and `main`; an import-safe URL guard alone executes. Paths must differ after absolute normalization, resolved existing ancestry, and existing file-identity checks, before execution and publication.

## Data Flow and Publication Order

```text
parse + reject aliases -> run workflows -> project both reports -> validate six gates
  -> write volatile observation (pass or fail)
  -> failure: exit nonzero, tracked bytes untouched
  -> success: format candidate in memory -> exact byte compare -> write only if different
```

Second identical run preserves tracked bytes and mtime.

## File Changes

| File                                                                              | Action   | Description                                                                                                                                          |
| --------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing product/service/tool/batch/test/docs paths already listed by this change | Preserve | Retain prior presentation, spine, parity, documentation, and benchmark-corpus decisions.                                                             |
| `scripts/benchmark-agent-workflows.mjs`                                           | Modify   | Add schemas, CLI output separation, pure exports/main guard, alias rejection, gate-first publication, and no-op writes; remove formatter subprocess. |
| `test/benchmark-agent-workflows.test.ts`                                          | Create   | Strict-TDD harness contract tests.                                                                                                                   |
| `benchmark/results/self-agent-workflows.json`                                     | Modify   | Publish deterministic schema v4 only after all gates pass.                                                                                           |
| `.gitignore`                                                                      | Modify   | Ignore `benchmark/results/runtime/`.                                                                                                                 |

## Testing Strategy

RED-first Vitest proves projections, exact bytes, aliases, import safety, six-gate validation, failure preservation, and two-run byte/mtime convergence. CLI integration uses argument-array subprocess execution and distinct temporary outputs for pass/fail ordering. Retain original unit/MCP/batch coverage; finish with format, lint, typecheck, test, and build gates.

## Threat Matrix

| Boundary                                   | Applicability and safe/failure behavior                                                  | Planned RED test                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| CLI evidence/observation paths             | Applicable: canonical or file-identity aliases fail before workflows/publication.        | Relative/absolute, symlink-parent, and existing hard-link aliases.   |
| Subprocess/process integration             | Applicable: no shell/composed command; importing runs nothing; child failure is nonzero. | Import-safe guard and argv-based CLI pass/fail.                      |
| Publication ordering                       | Applicable: validate gates and persist observation before tracked comparison/write.      | Failed gate preserves tracked hash/mtime; successful rerun is no-op. |
| Documentation-like execution               | N/A — no executable-file classification.                                                 | None.                                                                |
| Git repository, commit, push, PR selection | N/A — no VCS automation.                                                                 | None.                                                                |

## Migration / Rollout and Rollback

No product migration or flag. Commit schema v4 and ignore runtime observations. Rollback only the harness test, script, ignore rule, and tracked schema; compiler, MCP, batch, impact, index, and mutation remain untouched.

## Open Questions

None.
