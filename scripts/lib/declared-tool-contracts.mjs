// Declared tool contracts for the dsh-adapter smoke. Pure: no I/O, no process control.
// The smoke reads the fixture and the two tool catalogs and passes them in.

import { createHash } from "node:crypto";

/** Tools whose contract keeps its own RED/corrected checks in the smoke. */
export const RESERVED_TOOL_NAMES = Object.freeze(["ast_explore"]);

/**
 * Reduce a JSON Schema to its validation semantics. zod 3 and zod 4 serialize the same
 * constraints differently ($ref versus inlined, safe-integer bounds, uuid patterns), so the
 * public-baseline comparison must not depend on that serialization. Only `false` values of
 * additionalProperties and additionalItems are dropped; callers compare strictness explicitly.
 */
export function semanticSchema(node, root = node) {
  if (Array.isArray(node)) return node.map((item) => semanticSchema(item, root));
  if (node === null || typeof node !== "object") return node;
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
    const target = node.$ref
      .slice(2)
      .split("/")
      .reduce((value, key) => value?.[key], root);
    const rest = Object.fromEntries(Object.entries(node).filter(([key]) => key !== "$ref"));
    return semanticSchema({ ...target, ...rest }, root);
  }
  const result = {};
  for (const key of Object.keys(node).sort()) {
    const value = node[key];
    if (["$schema", "$defs", "definitions"].includes(key)) continue;
    if ((key === "additionalProperties" || key === "additionalItems") && value === false) continue;
    if ((key === "minimum" || key === "maximum") && Math.abs(value) === Number.MAX_SAFE_INTEGER) {
      continue;
    }
    if (key === "pattern" && node.format === "uuid") continue;
    result[key] = semanticSchema(value, root);
  }
  return result;
}

/** The declared form of an MCP tool: its description and semantic input schema. */
export function contractFromTool({ description, inputSchema }) {
  return { description, input_schema: semanticSchema(inputSchema) };
}

/** sha256 of the compared surface of one tool: name, description and semantic parameters. */
export function toolContractSha256(name, { description, parameters }) {
  return createHash("sha256")
    .update(JSON.stringify({ name, description, parameters: semanticSchema(parameters) }))
    .digest("hex");
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareDeclaredTool(name, publicTool, candidateTool, declaration, failures) {
  const declaredSchema = semanticSchema(declaration.input_schema);
  const candidateSchema = semanticSchema(candidateTool.parameters);
  if (candidateTool.description !== declaration.description) {
    failures.push({ tool: name, field: "description", reason: "mismatch_declaration" });
  }
  if (!sameJson(candidateSchema, declaredSchema)) {
    failures.push({ tool: name, field: "input_schema", reason: "mismatch_declaration" });
  }
  if (
    publicTool.description === declaration.description &&
    sameJson(semanticSchema(publicTool.parameters), declaredSchema)
  ) {
    failures.push({ tool: name, field: "description", reason: "stale_equals_public" });
  }
}

function compareUndeclaredTool(name, publicTool, candidateTool, failures) {
  if (candidateTool.description !== publicTool.description) {
    failures.push({ tool: name, field: "description", reason: "drift_from_public" });
  }
  if (!sameJson(semanticSchema(candidateTool.parameters), semanticSchema(publicTool.parameters))) {
    failures.push({ tool: name, field: "input_schema", reason: "drift_from_public" });
  }
}

/**
 * Compare the candidate tool catalog with the public baseline under the declared contract
 * changes. Catalogs are keyed by bare tool name. Pure and total: bad data becomes failures.
 */
export function compareToolContracts({ publicTools, candidateTools, declared }) {
  const failures = [];
  const declarations = declared.tools;
  for (const name of Object.keys(publicTools).sort()) {
    if (RESERVED_TOOL_NAMES.includes(name) || !(name in candidateTools)) continue;
    if (name in declarations) {
      compareDeclaredTool(
        name,
        publicTools[name],
        candidateTools[name],
        declarations[name],
        failures,
      );
    } else {
      compareUndeclaredTool(name, publicTools[name], candidateTools[name], failures);
    }
  }
  return { ok: failures.length === 0, failures };
}
