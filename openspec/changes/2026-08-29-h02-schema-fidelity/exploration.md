# Exploration: H-02 Harness Schema Fidelity

## Evidence

- H-01a merged at `24a67d9`; H-02 is the next roadmap gate.
- Exact MCP `tools/list` on that tree publishes 15 guarded tools.
- Fourteen inputs retain required fields. `ast_explore` publishes `type` and `properties` but no `required`, although `project_root` is mandatory.
- `ExploreInputSchema` chains three top-level refinements around the object. Runtime rejection survives, but JSON Schema publication loses the base requirement.
- The pinned bridge registers MCP `inputSchema` unchanged as Harness `parameters`; native mode sends that schema to the model. Output schemas are not model-facing in native mode, and JSON/TOON tools intentionally omit one universal structured output schema.

## Decision

Split the object-rooted publication schema from cross-field runtime validation. Preserve exact public RED/candidate GREEN evidence and assert the other 14 schemas remain identical.
