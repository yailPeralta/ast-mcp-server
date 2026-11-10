# Spike 0380: latency of template evidence in ast_explore

Issue #380. Question: how much wall time does Angular template evidence add to one `ast_explore`
request, and does a project past the template scan limit still get a typed result?

**Verdict: pass.** The added p95 at 501 components is 1059 ms, under the 2 s threshold. Every
request on the 2001-component fixture returned a result that matches the declared output schema.
No template read cache is required by the threshold; see Findings for the cost past the scan limit.

## Thresholds

| Check                                                                     | Limit      | Measured | Result |
| ------------------------------------------------------------------------- | ---------- | -------- | ------ |
| Added p95, `detail=full`, `limit=20`, 501 components, versus the baseline | <= 2000 ms | 1059 ms  | PASS   |
| 2001 components: every request returns a typed result                     | all        | 11 of 11 | PASS   |

## How it was run

- Command: `yarn benchmark:explore-templates` (`scripts/benchmark-explore-templates.mjs`), run on
  demand. It is not part of `yarn test`.
- Machine: 12th Gen Intel Core i5-12450H, 12 logical cores, 15 GiB RAM, Linux 7.0.0-42-generic.
- Node: v24.16.0. Commit: `33cd1fbae77677c0db819370bb8b4997dbfcff90` (clean tree), built with
  `yarn build`.
- Fixture: `generateMatrixProject` from `test/helpers/angular-matrix-fixture.ts`. 167 widgets give
  501 components and 501 external templates; 667 widgets give 2001. Each widget has one `@Input`
  named `label`, bound by two consumer host templates.
- Request: `ast_explore` with `query: "label"`, `detail: "full"`, `limit: 20` and the default
  `reference_limit`. It selects 20 `@Input` members, so one request runs 20 template collections.
- Baseline: the same tree without `@angular/core`, so template coverage is `not_applicable` and
  the output has no template field. Angular case: the same tree with `@angular/core` and
  `@angular/compiler` 21.
- Each case uses a new in-process server and MCP client. The first call is cold (it loads the
  project) and is the single warm-up; the next 10 calls are measured. With 10 samples the
  nearest-rank p95 is the maximum sample.
- Typed result: the client lists the tools first, so the SDK validates each structured result
  against the `ast_explore` output schema. A tool error or a schema mismatch fails the check.
- Peak RSS is the process high-water mark when the case ends. The four cases share one process in
  the order of the table, so each value includes the cases before it.

## Measurements

| Case          | Components | Symbols | Cold ms | p50 ms | p95 ms | Peak RSS MiB | Typed | Coverage of the 20 symbols |
| ------------- | ---------- | ------- | ------- | ------ | ------ | ------------ | ----- | -------------------------- |
| baseline-501  | 501        | 20      | 642     | 177    | 193    | 363          | yes   | none (`not_applicable`)    |
| angular-501   | 501        | 20      | 1667    | 1199   | 1252   | 476          | yes   | `completed` x20            |
| baseline-2001 | 2001       | 20      | 1232    | 657    | 671    | 657          | yes   | none (`not_applicable`)    |
| angular-2001  | 2001       | 20      | 5602    | 4772   | 4849   | 659          | yes   | `work_exhausted` x20       |

| Components | Added p50 ms | Added p95 ms | Added cold ms |
| ---------- | ------------ | ------------ | ------------- |
| 501        | 1021         | 1059         | 1025          |
| 2001       | 4115         | 4177         | 4370          |

A first run on the same machine, before the script was committed, gave an added p95 of 1039 ms at
501 components and 4146 ms at 2001.

## Findings

1. **The cost is per selected symbol.** At 501 components the added time is about 51 ms for each
   of the 20 symbols. Template collection reads and parses the templates again for every symbol;
   nothing is shared inside one request.
2. **Past the scan limit the request is slower and still incomplete.** At 2001 components every
   symbol stops at the 2000-template limit with `work_exhausted`. The request then adds about
   4.1 s and reports `template_coverage_incomplete` with `evidence_complete: false`. The result is
   typed, which is all the threshold asks for at this size, but the time is spent without reaching
   a completed verdict.
3. **A request-scoped template read cache is the direct lever** for both findings: it would make
   the 20 collections share one read and parse of each template. It is not needed to meet the
   threshold, so it is out of scope for #380. No follow-up issue was opened; that decision is left
   to the maintainer.
4. **Narrow requests cost less.** A request for one symbol (`symbol_path`, or a smaller `limit`)
   pays for one collection. `include_references: false` skips reference and template collection.

## Reproduce

```bash
yarn benchmark:explore-templates
yarn benchmark:explore-templates --widgets 167 --runs 10 --json result.json
```

Exit code 0 means both checks passed, 1 means a check failed, 2 means the harness failed. The
script needs Node 22.18 or later because it imports the TypeScript fixture helpers directly.
