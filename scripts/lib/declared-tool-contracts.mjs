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
