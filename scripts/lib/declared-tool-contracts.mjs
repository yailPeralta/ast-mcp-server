// Declared tool contracts for the dsh-adapter smoke. Pure: no I/O, no process control.
// The smoke reads the fixture and the two tool catalogs and passes them in.

import { createHash } from "node:crypto";

/** Tools whose contract keeps its own RED/corrected checks in the smoke. */
export const RESERVED_TOOL_NAMES = Object.freeze(["ast_explore"]);

const STRICT_ADDITIONAL_PROPERTIES = Object.freeze(["false", "undefined"]);

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

function compareFailures(left, right) {
  for (const key of ["tool", "field", "reason"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return 0;
}

function result(failures, tools, undeclared) {
  const sorted = [...failures].sort(compareFailures);
  return { ok: sorted.length === 0, failures: sorted, tools, undeclaredSha256: undeclared };
}

/** Compared, non-reserved tools that carry no declaration, in name order. */
function undeclaredNames(common, declarations) {
  return common.filter(
    (name) => !RESERVED_TOOL_NAMES.includes(name) && !Object.hasOwn(declarations, name),
  );
}

function undeclaredSha256(common, declarations, tools) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        undeclaredNames(common, declarations).map((name) => ({
          name,
          description: tools[name].description,
          parameters: semanticSchema(tools[name].parameters),
        })),
      ),
    )
    .digest("hex");
}

function toolEvidence(common, declarations, publicTools, candidateTools) {
  const evidence = {};
  for (const name of common) {
    if (RESERVED_TOOL_NAMES.includes(name)) continue;
    const entry = {
      status: Object.hasOwn(declarations, name) ? "declared" : "undeclared",
      publicSha256: toolContractSha256(name, publicTools[name]),
      candidateSha256: toolContractSha256(name, candidateTools[name]),
    };
    const declaration = declarations[name];
    if (isToolDeclaration(declaration)) {
      entry.declaredSha256 = toolContractSha256(name, {
        description: declaration.description,
        parameters: declaration.input_schema,
      });
    }
    evidence[name] = entry;
  }
  return evidence;
}

/** Render failures as `tool.field: reason`, joined by "; ". */
export function formatContractFailures(failures) {
  return failures.map(({ tool, field, reason }) => `${tool}.${field}: ${reason}`).join("; ");
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolSurface(value) {
  return (
    isPlainObject(value) && typeof value.description === "string" && isPlainObject(value.parameters)
  );
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) && sameJson(Object.keys(value).sort(), keys);
}

function isToolDeclaration(value) {
  return (
    hasExactKeys(value, ["description", "input_schema"]) &&
    typeof value.description === "string" &&
    isPlainObject(value.input_schema)
  );
}

/** Names of well-formed tools in a catalog; malformed entries are reported and dropped. */
function validCatalogNames(tools, failures) {
  const names = [];
  for (const name of Object.keys(tools)) {
    if (isToolSurface(tools[name])) names.push(name);
    else failures.push({ tool: name, field: "catalog", reason: "malformed" });
  }
  return names;
}

function symmetricDifference(left, right) {
  return [
    ...left.filter((name) => !right.includes(name)),
    ...right.filter((name) => !left.includes(name)),
  ];
}

/**
 * Compare the candidate tool catalog with the public baseline under the declared contract
 * changes. Catalogs are keyed by bare tool name. Pure and total: bad data becomes failures.
 */
export function compareToolContracts(input) {
  const { publicTools, candidateTools, declared, baselineVersion } = input ?? {};
  const failures = [];
  const wholeCatalog = (field, reason) => failures.push({ tool: "*", field, reason });
  if (!isPlainObject(publicTools) || !isPlainObject(candidateTools))
    wholeCatalog("catalog", "malformed");
  if (!hasExactKeys(declared, ["baseline", "tools"]) || !isPlainObject(declared.tools)) {
    wholeCatalog("declaration", "malformed");
  }
  if (failures.length > 0) return result(failures, {}, { public: null, candidate: null });
  if (declared.baseline !== baselineVersion) wholeCatalog("baseline", "baseline_mismatch");

  const publicNames = validCatalogNames(publicTools, failures);
  const candidateNames = validCatalogNames(candidateTools, failures);
  for (const name of symmetricDifference(Object.keys(publicTools), Object.keys(candidateTools))) {
    failures.push({ tool: name, field: "catalog", reason: "names_differ" });
  }
  const common = publicNames.filter((name) => candidateNames.includes(name)).sort();
  for (const [name, declaration] of Object.entries(declared.tools)) {
    if (RESERVED_TOOL_NAMES.includes(name)) {
      failures.push({ tool: name, field: "declaration", reason: "reserved_tool" });
    } else if (!isToolDeclaration(declaration)) {
      failures.push({ tool: name, field: "declaration", reason: "malformed" });
    } else if (!common.includes(name)) {
      failures.push({ tool: name, field: "declaration", reason: "unknown_tool" });
    }
  }
  for (const name of common) {
    if (RESERVED_TOOL_NAMES.includes(name)) continue;
    const declaration = Object.hasOwn(declared.tools, name) ? declared.tools[name] : undefined;
    if (declaration === undefined) {
      compareUndeclaredTool(name, publicTools[name], candidateTools[name], failures);
    } else if (isToolDeclaration(declaration)) {
      compareDeclaredTool(name, publicTools[name], candidateTools[name], declaration, failures);
    }
  }
  for (const name of candidateNames) {
    if (RESERVED_TOOL_NAMES.includes(name)) continue;
    // The semantic comparison drops `additionalProperties: false`, so strictness is explicit:
    // a tool may declare it false or leave it unset, never accept arbitrary properties.
    if (
      !STRICT_ADDITIONAL_PROPERTIES.includes(
        String(candidateTools[name].parameters.additionalProperties),
      )
    ) {
      failures.push({ tool: name, field: "additionalProperties", reason: "loosened" });
    }
  }
  return result(failures, toolEvidence(common, declared.tools, publicTools, candidateTools), {
    public: undeclaredSha256(common, declared.tools, publicTools),
    candidate: undeclaredSha256(common, declared.tools, candidateTools),
  });
}
