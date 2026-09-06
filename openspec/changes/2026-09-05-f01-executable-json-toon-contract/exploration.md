## Exploration: F-01 executable JSON/TOON contract

### Current State

`main` is clean at `6173a39a73f1540c17335a330ea7f14f982387cb`. GitHub issue #235 is open with `status:approved` and `type:chore`; no open PR references #235. Repository evidence treats RDD as `disabled/unmanaged`, so no receipt-review authority is claimed.

The registered MCP path is `createServer()` → `toolCatalog.registerAll()` → each tool callback → `formattedResult()`. The four eligible tools are exactly `ast_search_symbols`, `ast_find_references`, `ast_get_impact`, and `ast_get_diagnostics`. Each publishes `output_format` as the closed `json | toon` enum with default `json`, omits a universal MCP `outputSchema`, validates a canonical object with its internal Zod schema, returns JSON as canonical `structuredContent`, and returns TOON only as `{format:"toon",data}` in `structuredContent`; both success forms use `content: []`. `formattedResult()` encodes, enforces a 10 MiB UTF-8 bound, decodes, and deep-compares before returning TOON.

A fresh stdio MCP probe against the built v0.13.1 server executed eight paired explicit-JSON/TOON scenarios: non-empty and empty symbol pages, non-empty and empty reference pages, truncated and root-only impact, and non-empty and empty diagnostics. Every call succeeded, every TOON result used the exact two-key envelope, and every decoded TOON value equaled its paired JSON value after narrowly normalizing only `duration_ms` and `checked_at`. Raw equality held for references; raw differences elsewhere were exclusively expected per-invocation telemetry. A second edge probe round-tripped two diagnostics with nullable locations, rejected `file_path: null`, and confirmed unsupported tools omit `output_format` from `tools/list` while the current SDK/Zod path strips an unknown supplied field rather than treating it as a format request.

This exploration therefore found **no current JSON/TOON runtime defect**. F-01 is a missing retained executable oracle: existing tests prove the presenter losslessly and execute TOON for all four registered handlers, but no checked test performs paired JSON/decoded-TOON canonical equivalence across all four with empty, paginated, and bounded cases.

Compiler-backed AST tools were available but returned no model-visible status or symbol evidence in this session. File mapping below is therefore an explicit textual fallback and is not presented as compiler-authoritative.

### Affected Areas

- `src/tools/result.ts` — shared canonical validation, JSON presentation, TOON envelope, lossless decode check, and 10 MiB limit; forecast is **no production change** unless the executable oracle exposes a defect.
- `src/tools/search_symbols.ts` — eligible handler; includes detail projection, pagination, arrays, numbers, and volatile `duration_ms`.
- `src/tools/find_references.ts` — eligible handler; includes boolean/default behavior, context Unicode/multiline strings, pagination, and empty pages.
- `src/tools/get_impact.ts` — eligible handler; includes bounded node/edge/depth outputs, booleans, empty `relationship_kinds`, nullable truncation reason, and volatile `checked_at`.
- `src/tools/get_diagnostics.ts` — eligible handler; includes nullable locations, signed numeric codes, optional aggregates, pagination, and volatile `duration_ms`.
- `src/tools/catalog.ts` — authoritative closed eligibility projection (`directToon`) and negative-control source for unsupported tools.
- `src/server.ts` — registered MCP server composition used by in-memory tests; no forecast production change.
- `test/mcp.integration.test.ts` — currently executes TOON for all four and checks eligibility/envelopes, but does not pair each call with canonical JSON and deep-compare.
- `test/result-format.test.ts` — already covers Unicode, delimiters, quotes, multiline/prompt-like text, empty strings, booleans, nullable numbers, finite decimals, non-finite lossless rejection, and the TOON byte limit.
- `test/tool-catalog.test.ts` — already proves the exact four-tool `directToon` set.
- `scripts/mcp-smoke.mjs` — real stdio MCP transport exists, but currently exercises TOON only for symbol search and does not prove four-tool paired equivalence.
- `package.json` — possible one-line command entry for a retained stdio format-contract oracle.

### Deterministic Reproduction

Baseline command:

```text
yarn vitest run test/result-format.test.ts test/tool-catalog.test.ts test/mcp.integration.test.ts --no-file-parallelism
```

Result: exit 0; 3 files passed; 43 tests passed. The existing test named `exposes lossless TOON envelopes for eligible collection reads only when requested` passed, demonstrating that a newly added equivalent happy-path assertion would not be a legitimate behavior-first RED.

Stdio probe: Node 24.16.0 MCP `Client` + `StdioClientTransport` launched `dist/index.js`, created an isolated temporary TypeScript fixture and runtime home/cache, called each scenario twice with explicit `output_format`, decoded with pinned `@toon-format/toon@4.1.0`, normalized only `duration_ms`/`checked_at`, and hashed canonical JSON bytes. The complete normalized report SHA-256 was `093110d4770aa5642433074ed85f715bccbd43b7cdb30a032586b67f5224940f`.

| Scenario               | Shape                                 | JSON / decoded TOON SHA-256                                        | Result    |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------ | --------- |
| search-page            | paginated, full, Unicode-capable      | `ab208daa0a3f2e3e838d1574f7781ea041afaf892cdf3d1797c810c679775d36` | equal     |
| search-empty           | empty array/page                      | `a2bbd89eb6d2e3f61767c3845a1e5103d4ca216dcc8d5fcbfb994921fd976ea6` | equal     |
| references-page        | context, Unicode, limit 1, `has_more` | `8f7bb456494ed858ef161d3d7bf38a32f1846b748de4e7e3200e3b7d4f6579de` | raw equal |
| references-empty-page  | offset beyond total, boolean false    | `898dbf9a8d1bdb07bf8d13e091807616ff5750c066351b477568af7f45fe2aa1` | raw equal |
| impact-bounded         | `max_nodes=1`, truncated/incomplete   | `cd6549b7a44c60fd54b5d30e74c1907f97c2a57954423a291196337f22f950b5` | equal     |
| impact-root-only       | depth 0, empty kinds, complete        | `759ddf450c44bb52bf1e2280d47501bd5168c0c56504e0a03250db3bd65dd9fa` | equal     |
| diagnostics-page       | aggregates, numeric code, limit 1     | `2588dbe48d771e01f52098d90c5ee5d839b6ae6ebf58bbfccbd226e1c68779a0` | equal     |
| diagnostics-empty-page | empty diagnostics                     | `2cec6fd9ec77cd5111143b4eb02fc30339e9229199f2a01eb1ddf1cbc77eec03` | equal     |

`tools/list` returned 15 guarded tools (apply absent). Exactly the four eligible tools exposed `output_format`, each with enum `json, toon`, default `json`, and no `outputSchema`; all other 11 guarded tools omitted the field. No Harness checkout inspection was needed.

Relevant source hashes at the reproduction commit:

- `src/tools/result.ts`: `6d47797790c3a8785b2f67dd828692b9717630529c6d83e2fa649bb20688b2ba`
- `src/tools/search_symbols.ts`: `0186a149789e9316a9364b717ad053b8f107f6ecbda020259e0e312dbd557710`
- `src/tools/find_references.ts`: `c4f25f0cd8463264cce686765f164ccbc73975ca8bb9326b61de479b5ee9b2b0`
- `src/tools/get_impact.ts`: `a480b6cf96d05476729e0994376ec8ec63ff6aec201878b5b87591c71ca43af5`
- `src/tools/get_diagnostics.ts`: `f7ab9f5984645d55490ed56b66a897f2afffb938463846f9c7093967db6226b5`
- `test/mcp.integration.test.ts`: `cb530d3b97bba438490e462ffae1f6ac394e722aea1455df3679a5aba3a7cce8`

### Edge-Case Inventory

| Edge                                                     | Current evidence                                                                      | F-01 retained-oracle recommendation                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Unicode, delimiters, quotes, multiline, prompt-like text | Pure presenter test plus stdio Unicode symbol/reference fixture                       | Retain at least one transport case; do not duplicate the whole pure fixture corpus.                          |
| Empty arrays/pages                                       | Stdio search, references, diagnostics, and impact root-only cases                     | Required for every collection family.                                                                        |
| Optional and null                                        | Optional fields omitted; `file_path:null` rejected; nullable diagnostics round-trip   | Preserve omission and null as distinct cases; do not make optional inputs nullable.                          |
| Numeric and boolean                                      | Pagination, diagnostic codes/positions, durations, impact budgets, flags              | Compare finite canonical values; keep non-finite rejection in the pure presenter test.                       |
| Large/bounded                                            | Pagination limit 1, impact budget truncation, existing 10 MiB presenter boundary test | Avoid a 10 MiB transport fixture; retain bounded handler cases and the focused size unit test.               |
| Lossless rejection                                       | `Number.POSITIVE_INFINITY` already fails in `formattedResult()`                       | Reference the existing unit gate; no public schema expansion.                                                |
| Schema eligibility                                       | Exact four-tool set already asserted from `tools/list` and `toolCatalog.directToon`   | Drive the executable matrix from the closed expected set and fail if catalog/schema/cases drift.             |
| Unsupported tools                                        | Eleven guarded tools omit `output_format`; apply remains absent                       | Treat schema omission as the contract. Do not add universal output format or invent unknown-field rejection. |

### RED Feasibility

A behavior-first RED is **not feasible on current `main`**: direct JSON succeeds, TOON succeeds, TOON decodes losslessly, and normalized canonical values match for every required family. An ordinary paired-equivalence test written now would pass and must be called characterization, not RED.

The legitimate missing-invariant RED is command/contract enforcement: first add an acceptance test or CI invocation requiring a dedicated checked stdio oracle (for example `yarn test:mcp-formats`) and require its case inventory to equal the exact `toolCatalog.directToon`/`tools/list` eligible set. Before the oracle exists, that command/inventory gate fails for the real missing invariant—there is no repository-retained four-tool executable proof. GREEN adds the oracle only. Production code may change only if that oracle exposes behavior contradicting the probe. The proposal should explicitly document this characterization-first exception to strict TDD rather than fabricate a runtime failure.

### Approaches

1. **Dedicated stdio contract oracle (recommended)** — add one deterministic script and a small test/package command that pairs explicit JSON/TOON calls for the exact eligible set, normalizes only declared volatile telemetry, and checks negative schema eligibility.
   - Pros: Proves the real process/transport boundary; executable outside Vitest internals; directly closes issue #235; future catalog drift fails closed.
   - Cons: Requires careful temporary-runtime cleanup and narrowly reviewed volatility normalization; adds some fixture code.
   - Effort: Low; forecast 220–320 authored changed lines.

2. **Extend only `test/mcp.integration.test.ts`** — parameterize paired calls over the existing in-memory MCP client/server fixture.
   - Pros: Smallest diff, fast, reuses current fixture and helpers.
   - Cons: The new assertions pass immediately, so there is no RED; weaker than stdio process-boundary evidence; easy for the four-tool set to drift unless explicitly tied to catalog/schema inventory.
   - Effort: Low; forecast 80–140 authored changed lines.

3. **Change shared presenter or public schemas** — modify production formatting/output schemas to manufacture a failing behavior.
   - Pros: None supported by evidence.
   - Cons: Invents behavior, risks compatibility, conflicts with the issue and H-02 decision, and may accidentally implement #103/universal `outputSchema` scope.
   - Effort: Rejected.

### Recommendation

Proceed to `sdd-propose` as a single chore work unit implementing a dedicated deterministic stdio executable oracle, with no planned production changes. The oracle must compare canonicalized paired results, assert both MCP success envelopes, cover empty/paginated/bounded and nullable/Unicode cases, verify exact schema eligibility, and delegate non-finite/10 MiB rejection to the existing focused presenter tests. Canonicalization must use an explicit closed allowlist of `duration_ms` and `checked_at`, prove no other difference exists, and never normalize semantic fields.

The work unit should include its test command and package entry in the same commit. Rollback is deletion of the oracle/test command only; no runtime behavior or public schema changes should need reverting.

### Scope and Non-Goals

In scope:

- Registered MCP Client/Server execution for the exact four eligible tools.
- Explicit JSON and TOON calls, decoded canonical equivalence, success envelope assertions, and closed case inventory.
- Empty, paginated, bounded/truncated, Unicode, nullable, optional, numeric, boolean, aggregate, and unsupported-schema controls.
- Deterministic hashes after only declared telemetry normalization.

Non-goals:

- Universal MCP `outputSchema` or any public schema change.
- Issue #103 output-vocabulary projection.
- R-01 relationship coverage/recovery semantics.
- Apply registration, apply authorization, mutation flows, or Harness changes.
- UI specialization, Code Mode, proxying, or new serialization formats.
- Changing unknown-extra-input behavior for unsupported tools.

### Forecast and Budget

- Likely files: one new stdio oracle script, one focused test or package-script entry, and at most a concise documentation reference if proposal/spec requires it.
- Production forecast: zero lines unless the oracle contradicts current evidence.
- Authored review forecast: 220–320 additions/deletions, **Low** 400-line risk, one autonomous work unit, no chain recommended.
- Focused gate: dedicated format oracle plus `test/result-format.test.ts`, `test/tool-catalog.test.ts`, and relevant MCP integration test.
- Runtime gate: the dedicated stdio oracle itself; full `yarn test:mcp` remains a supporting smoke.
- Rollback: remove the oracle/test/package command as one independent unit; public runtime remains unchanged.

### Risks

- Comparing raw sequential calls would falsely report defects from `duration_ms` and `checked_at`; normalization must be closed and audited.
- Over-normalization could conceal semantic drift; compare the complete recursively normalized object and fail on every other key/value difference.
- A fixture that relies on ambient HOME/cache would be nondeterministic; use isolated temporary roots and guaranteed cleanup.
- Large transport fixtures can make the oracle slow; retain the existing focused 10 MiB unit boundary instead of generating oversized compiler projects.
- Unknown fields on unsupported tools are currently stripped even though their schemas omit `output_format`; changing that is outside issue authority.
- If proposal insists on a behavior-first RED despite the passing runtime evidence, work is blocked pending maintainer clarification rather than permission to invent a defect.

### Blockers

No blocker to proposal. There is a routing condition: implementation must be scoped as characterization/contract enforcement, not runtime correction. If the next phase requires a production behavior-first RED as an absolute prerequisite, stop and request an explicit strict-TDD characterization exception because the claimed behavior is already proven on current `main`.

### Ready for Proposal

Yes — route to `sdd-propose`. State clearly that F-01 revealed no runtime defect, that the missing invariant is a retained four-tool executable MCP oracle, and that one ≤400-line work unit should add only that oracle unless new evidence fails.
