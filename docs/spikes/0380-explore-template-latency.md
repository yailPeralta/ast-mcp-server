# Spike 0380: latency of template evidence in ast_explore

Issue #380. Question: how much wall time does Angular template evidence add to one `ast_explore`
request, and does a project past the template scan limit still get a typed result?

**Verdict: pass.** The added p95 at 501 components is 1059 ms, under the 2 s threshold. Every
request on the 2001-component fixture returned a result that matches the declared output schema.
No template read cache is required by the threshold; see Findings for the cost past the scan limit.
A request-scoped cache was added afterwards in #454; its numbers are in
[Request-scoped template cache (#454)](#request-scoped-template-cache-454).

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

## Request-scoped template cache (#454)

Issue #454 took the lever named in finding 3. One `ast_explore` request now creates a
`TemplateScanCache` and passes it to the template collection of every selected symbol. The cache
holds the work that does not depend on the symbol: the component list, each located template, each
template read (with its path check and size check) and each parse. With
`reference_detail: "context"` the context lines of an external template come from the text the
scan already read, so the file is not read a second time; a source file with an inline template is
read from disk once per request for its context lines. The cache is bound to one project context
and nothing is kept after the request. `ast_find_references` passes no cache, so each of its calls
works alone.

Scan budgets stay per symbol. A collection charges its own template, byte and node budget for
every template, whether the cache held it or not, so each symbol stops at the same point as before
and gets the same verdict.

### How it was run

Same machine, Node version (v24.16.0), fixture, request and command as above. Both sides were
measured on the same day, each from a clean tree:

- Before: `426467e91d9515b76a9da62387344e428e6a7080` (`main` with #380, no cache).
- After: `8baf9b198b956dcdb9e76451c012aebf2b0f63c1` (the cache).

### Measurements

Before (`426467e`):

| Case          | Components | Symbols | Cold ms | p50 ms | p95 ms | Peak RSS MiB | Typed | Coverage of the 20 symbols |
| ------------- | ---------- | ------- | ------- | ------ | ------ | ------------ | ----- | -------------------------- |
| baseline-501  | 501        | 20      | 661     | 177    | 195    | 364          | yes   | none (`not_applicable`)    |
| angular-501   | 501        | 20      | 1705    | 1218   | 1277   | 475          | yes   | `completed` x20            |
| baseline-2001 | 2001       | 20      | 1236    | 661    | 812    | 656          | yes   | none (`not_applicable`)    |
| angular-2001  | 2001       | 20      | 5798    | 4899   | 5397   | 657          | yes   | `work_exhausted` x20       |

After (`8baf9b1`):

| Case          | Components | Symbols | Cold ms | p50 ms | p95 ms | Peak RSS MiB | Typed | Coverage of the 20 symbols |
| ------------- | ---------- | ------- | ------- | ------ | ------ | ------------ | ----- | -------------------------- |
| baseline-501  | 501        | 20      | 638     | 181    | 216    | 365          | yes   | none (`not_applicable`)    |
| angular-501   | 501        | 20      | 756     | 360    | 371    | 494          | yes   | `completed` x20            |
| baseline-2001 | 2001       | 20      | 1253    | 664    | 690    | 677          | yes   | none (`not_applicable`)    |
| angular-2001  | 2001       | 20      | 2204    | 1361   | 1441   | 679          | yes   | `work_exhausted` x20       |

Added by template evidence, next to the #380 run recorded above:

| Components | Run                | Added p50 ms | Added p95 ms | Added cold ms |
| ---------- | ------------------ | ------------ | ------------ | ------------- |
| 501        | #380 (`33cd1fb`)   | 1021         | 1059         | 1025          |
| 501        | Before (`426467e`) | 1040         | 1082         | 1044          |
| 501        | After (`8baf9b1`)  | 179          | 156          | 118           |
| 2001       | #380 (`33cd1fb`)   | 4115         | 4177         | 4370          |
| 2001       | Before (`426467e`) | 4238         | 4585         | 4562          |
| 2001       | After (`8baf9b1`)  | 698          | 751          | 951           |

The added p95 is the difference of two maxima of 10 samples, so it moves between runs; at 501
components this run has it below the added p50 because the baseline had one slow sample. Two more
runs of the same source gave an added p50 of 229 and 180 ms at 501 components and 657 and 706 ms
at 2001. Their added p95 was 306 and 183 ms at 501 components, and 909 and 2591 ms at 2001; the
last value comes from a single 3338 ms sample among the ten. The p50 is the steadier number.

### Findings

1. **The added time no longer grows with the number of symbols times the number of templates.**
   The added p50 falls by about 83% at both sizes (1040 to 179 ms, 4238 to 698 ms).
2. **Most of the saving is not the read or the parse.** A CPU profile of the run before the change
   shows the time in the per-template path check (`lstat` calls under `checkTemplatePath`), in
   listing the component classes twice per symbol and in locating each template. This fixture
   parses few templates, because a template is parsed only when the selector prefilter matches.
   The cache keeps the whole read step, path check included, and the component list.
3. **Verdicts are unchanged.** 501 components still give `completed` x20 and 2001 components
   still give `work_exhausted` x20: each symbol still stops at the 2000-template limit. The request
   is faster and still incomplete; raising the limit is a separate decision.
4. **What is left is mostly outside the template collection.** In a CPU profile of the
   2001-component run after the change, the consumer scans of all 20 symbols take about 100 ms per
   request. A larger part of the remaining difference to the baseline is `listTemplateFiles` in the
   workspace snapshot that every request takes when the project session synchronises (about
   240 ms per request, again mostly `lstat`). That work is per request, not per symbol, and
   reducing it needs state that lives across requests, which #454 excludes. These two figures are
   estimates from one profile, not benchmark results.
5. **Memory.** The cache keeps the bytes and text of the templates read during the request. Peak
   RSS of the 501-component case rose from 475 to 494 MiB. The cache also keeps the parsed
   templates until the request ends. Retention is bounded by the part of the project that one
   symbol's scan budget reaches, and peak RSS was measured on the benchmark fixture only.
6. **Not shared.** Loading the compiler, the base-class walk for inherited members and the scope
   resolver still run per symbol. They depend on the symbol or were too small in the profile to
   justify a change.
7. **Not measured.** The benchmark request uses the default `reference_detail`, so the numbers
   above do not include the context-line change.

## Reproduce

```bash
yarn benchmark:explore-templates
yarn benchmark:explore-templates --widgets 167 --runs 10 --json result.json
```

Exit code 0 means both checks passed, 1 means a check failed, 2 means the harness failed. The
script needs Node 22.18 or later because it imports the TypeScript fixture helpers directly.
