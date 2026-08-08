import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prepareScaffoldClass } from "../services/operations.js";
import type { ClassScaffoldSpec } from "../services/scaffold.js";
import { createRequestContext } from "../services/request-context.js";
import { errorResult, structuredResult } from "./result.js";
import { PreparedOperationOutputSchema, serializePreparedOperation } from "./operation-schema.js";

const IdentifierSchema = z.string().min(1).max(200);
const TypeTextSchema = z.string().min(1).max(10_000);
const AccessSchema = z.enum(["public", "protected", "private"]);
const ConstructorAccessSchema = z.enum([
  "public",
  "protected",
  "private",
  "public readonly",
  "protected readonly",
  "private readonly",
]);

const ImportSchema = z
  .object({
    from: z.string().min(1).max(500),
    named: z.array(IdentifierSchema).max(100).default([]),
    default: IdentifierSchema.optional(),
  })
  .strict();

const ParameterSchema = z
  .object({
    name: IdentifierSchema,
    type: TypeTextSchema,
  })
  .strict();

const ConstructorParameterSchema = ParameterSchema.extend({
  access_modifier: ConstructorAccessSchema,
}).strict();

const PropertySchema = z
  .object({
    name: IdentifierSchema,
    type: TypeTextSchema,
    access: AccessSchema.default("private"),
    initializer: z.string().max(10_000).optional(),
  })
  .strict();

const MethodSchema = z
  .object({
    name: IdentifierSchema,
    is_async: z.boolean().default(false),
    return_type: TypeTextSchema,
    access: AccessSchema.default("public"),
    parameters: z.array(ParameterSchema).max(100).default([]),
    decorators: z.array(z.string().min(1).max(10_000)).max(50).default([]),
    docs: z.array(z.string().min(1).max(10_000)).max(50).default([]),
  })
  .strict();

export const ScaffoldClassInputSchema = z
  .object({
    project_root: z.string().min(1),
    file_path: z.string().min(1).max(1_000),
    class_name: IdentifierSchema,
    extends: TypeTextSchema.optional(),
    implements: z.array(TypeTextSchema).max(50).default([]),
    decorators: z.array(z.string().min(1).max(10_000)).max(50).default([]),
    imports: z.array(ImportSchema).max(100).default([]),
    constructor_params: z.array(ConstructorParameterSchema).max(100).default([]),
    properties: z.array(PropertySchema).max(200).default([]),
    methods: z.array(MethodSchema).min(1).max(200),
    dry_run: z.literal(true).default(true),
    allow_new_errors: z.boolean().default(false),
  })
  .strict();

const ScaffoldClassOutputSchema = PreparedOperationOutputSchema.extend({
  file: z.string(),
  class_name: z.string(),
  outline: z.string(),
  pending_methods: z.array(z.string()),
});

type ScaffoldClassArgs = z.infer<typeof ScaffoldClassInputSchema>;
type ScaffoldToolRegistrar = (
  name: string,
  config: {
    title: string;
    description: string;
    inputSchema: typeof ScaffoldClassInputSchema;
    outputSchema: typeof ScaffoldClassOutputSchema.shape;
    annotations: {
      readOnlyHint: boolean;
      destructiveHint: boolean;
      idempotentHint: boolean;
      openWorldHint: boolean;
    };
  },
  handler: (args: ScaffoldClassArgs, extra: { signal: AbortSignal }) => Promise<unknown>,
) => void;

function toSpec(args: ScaffoldClassArgs): ClassScaffoldSpec {
  return {
    className: args.class_name,
    ...(args.extends ? { extends: args.extends } : {}),
    implements: args.implements,
    decorators: args.decorators,
    imports: args.imports.map((item) => ({
      from: item.from,
      named: item.named,
      ...(item.default ? { default: item.default } : {}),
    })),
    constructorParams: args.constructor_params.map((parameter) => ({
      name: parameter.name,
      type: parameter.type,
      accessModifier: parameter.access_modifier,
    })),
    properties: args.properties.map((property) => ({
      name: property.name,
      type: property.type,
      accessModifier: property.access,
      ...(property.initializer !== undefined ? { initializer: property.initializer } : {}),
    })),
    methods: args.methods.map((method) => ({
      name: method.name,
      isAsync: method.is_async,
      returnType: method.return_type,
      accessModifier: method.access,
      params: method.parameters.map((parameter) => ({
        name: parameter.name!,
        type: parameter.type!,
      })),
      decorators: method.decorators,
      docs: method.docs,
    })),
  };
}

export function registerScaffoldClass(server: McpServer): void {
  // The SDK compatibility overload exceeds TypeScript's instantiation depth for this schema.
  // Keep the complete runtime schema and isolate only the registrar type.
  const registerTool = server.registerTool.bind(server) as unknown as ScaffoldToolRegistrar;
  registerTool(
    "ast_scaffold_class",
    {
      title: "Prepare Class Scaffold",
      description:
        "Prepares a hash-bound new TypeScript class file without writing it. Each method body throws an explicit not-implemented error. Review the diff, then apply the returned operation_id and plan_hash with ast_apply_operation.",
      inputSchema: ScaffoldClassInputSchema,
      outputSchema: ScaffoldClassOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra) => {
      const requestContext = createRequestContext(extra.signal);
      try {
        const prepared = await prepareScaffoldClass(
          {
            projectRoot: args.project_root,
            filePath: args.file_path,
            spec: toSpec(args),
            allowNewErrors: args.allow_new_errors,
          },
          requestContext,
        );
        const structuredContent = {
          ...serializePreparedOperation(prepared.operation),
          file: prepared.file,
          class_name: prepared.className,
          outline: prepared.outline,
          pending_methods: prepared.pendingMethods,
        };
        return structuredResult(structuredContent);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
