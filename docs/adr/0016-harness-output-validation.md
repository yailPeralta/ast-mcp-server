# ADR 0016: Enforce advertised MCP output contracts in an isolated bridge candidate

Status: Proposed implementation; bridge-candidate direction explicitly selected by the maintainer for #103.

## Decision question

How can the adapter preserve the complete advertised MCP output contract without claiming that the pinned Harness registry's narrower schema language is equivalent?

## Context

The immutable baseline is Harness `cd5ef8148158c3a752a658978873241fdf8e2bbc`, tag `dsh-v0.1.2-alpha.1`, bridge `0.1.2-alpha.1`. Source inspection shows that the bridge bypasses SDK output prevalidation and silently replaces unsupported schemas with an optional, lossless-JSON `structuredContent` envelope. The registry still validates that envelope; it does not enforce the original schema.

Direct inventory of public AST 0.13.0 has 15 guarded tools: 12 advertised output schemas and three unadvertised JSON/TOON tools. Current AST 0.13.1 has 11 advertised schemas and four unadvertised tools, adding `ast_get_impact` to that exception. Every advertised schema exceeds the pinned registry vocabulary. Enumerating either direct allow catalog adds `ast_apply_operation` and its schema; this is inventory only, not an apply invocation or Harness capability grant.

## Selected direction

Correct the owner of the lost contract: an isolated bridge candidate, with a distinct joint core/bridge source and artifact identity. Keep the original baseline immutable, direct AST/Zod and MCP schemas unchanged, and the active GUI installation untouched.

The implementation must:

- enforce the original advertised output schema before returning a successful tool result;
- keep protocol/envelope validation separate from full declared-schema validation, retaining existing registry and generated-type precision wherever the registry can represent the original schema;
- expose an explicit distinction between bridge-enforced advertised schemas and tools that advertise no schema;
- fail closed when an advertised schema cannot be compiled, rather than silently downgrading it;
- bind validation to the registered tool's schema snapshot and replace it on tool-list changes, without stale SDK-cache authority;
- preserve bounded, redacted errors, cancellation, reconnect/registration ownership, and apply denial.

Use a maintained strict JSON Schema compiler owned by each bridge registration, with direct dependencies on the already locked Ajv and format packages. The installed SDK 1.29.0 default disables strict/schema checks, caches by `$id`, and can treat an asynchronous validator's Promise as success; it is not sufficient authority for this decision.

Invoke the bridge's pure synchronous predicate at the registry's existing canonical-success admission point, after lossless snapshot/envelope validation and before rendering or metadata. A small generic output-validation callback must also cover nested calls, wrapper-authored successes and post-execution replacements. Pin the owning output definition for the admitted dispatch while preserving live authorization checks; never replace it with a newer registration's validator midway through an older call. This extends the existing owner rather than adding a companion, mutable validation registry, or new lifecycle controller.

Accept implicit draft 2020-12 and explicit draft-07 (`http://json-schema.org/draft-07/schema`, with optional trailing `#`), with local JSON Pointer references to recognized schema positions, including boolean schemas. Reject unknown keywords/formats even in unused definitions, other dialects, vocabulary declarations, embedded resource IDs, anchors/dynamic references and asynchronous schemas at registration. Defaults, enum literals and property names remain data, not schema declarations. Do not coerce data, insert defaults, remove properties, fetch remote schemas or relocate the original schema under an envelope that changes reference resolution. Runtime status describes declared-schema enforcement, not equivalence of the registry's envelope schema or validation of arbitrary presentation text.

## Alternatives rejected

| Alternative                                          | Reason                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Reports/docs only                                    | Does not remove the runtime-silent fallback; cannot satisfy #103's runtime requirement                                      |
| Strip unsupported keywords                           | Numeric/string constraints and overlapping unions cannot generally be projected losslessly into the fixed registry language |
| Add a companion validator or another public tool     | Duplicates ownership and lifecycle responsibilities that belong to the bridge                                               |
| Change the active GUI or silently repin the baseline | Breaks the evidence boundary and exceeds the selected isolated-candidate scope                                              |

## Verification and publication boundary

Use the maintainer-selected Feature Branch Chain for #103. Keep the tracker draft/no-merge until the child units carry the implementation, reproducible evidence and passing CI. A docs-only tracker head or locally verified but unversioned workbench is not the joint runtime candidate. The chain does not authorize npm publication, default-baseline repinning or active-GUI changes.

First reproduce the loss on the exact baseline using a controlled MCP fault fixture, not claims that the real AST server emits malformed data. The candidate must reject wrong types and missing required structured content, preserve valid results, distinguish absent schemas, retain full constraints/references, and handle schema replacement without stale validation.

Inventory actual public and candidate AST schemas and registry definitions with hashes. Execute both exact bridge artifacts through the pinned ToolRuntime and an isolated packed AST consumer. Missing identities or prerequisites fail the gate. Direct-MCP tests and source inspection alone are not host compatibility proof.

The candidate bridge requires the candidate core's admission callback. Installing only the new bridge over the baseline core can emit metadata without executing that callback, so an unchanged version string or peer range is not a compatibility identity. Verification must bind both actual loaded artifacts; any source correction invalidates the prior candidate proof.

No published compatibility or installation claim is granted by this ADR. Any eventual supported candidate requires its own verified identity and delivery decision. Rollback restores the verified baseline core/bridge pair and documents its unsupported declared-output validation, never a false fidelity claim.
