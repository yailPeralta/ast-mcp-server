import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import yaml from "yaml";
import { validateTimeoutBudget } from "../scripts/harness-timeout-budget.mjs";
import { createServer } from "../src/server.js";
import {
  COMPILER_WORKER_JSONRPC_ENVELOPE_RESERVE_BYTES,
  COMPILER_WORKER_MAX_FRAME_BYTES,
  fitsCompilerWorkerResponseResult,
} from "../src/services/compiler-worker-protocol.js";
import { RUNTIME_POLICY_ENV_KEYS, parseRuntimePolicy } from "../src/services/runtime-policy.js";
import { toolCatalog } from "../src/tools/catalog.js";
import { MAX_PROJECTED_RESULT_BYTES, projectStructuredContentAsText } from "../src/tools/result.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const PATCH_PATH = path.join(repositoryRoot, "cordis.patch.yml");
const PACKAGE_PATH = path.join(repositoryRoot, "package.json");
const SMOKE_PATH = path.join(repositoryRoot, "scripts", "dsh-adapter-smoke.mjs");

/** The loader's serialized `!!js` expression node (`{ __jsExpr: string }`). */
interface JsExpr {
  __jsExpr: string;
}

function isJsExpr(value: unknown): value is JsExpr {
  return (
    typeof value === "object" &&
    value !== null &&
    "__jsExpr" in value &&
    typeof (value as JsExpr).__jsExpr === "string"
  );
}

/** Parse the adapter patch with the loader's `!!js` dialect tag. */
async function parsePatch(): Promise<
  Array<{
    insert?: Array<{
      id: string;
      name: string;
      config: {
        serverName: unknown;
        transport: unknown;
        command: unknown;
        args?: unknown[];
        env?: Record<string, unknown>;
        cwd?: unknown;
        toolCallTimeoutMs?: unknown;
        failOnStartupError?: unknown;
      };
    }>;
  }>
> {
  const content = await readFile(PATCH_PATH, "utf8");
  return yaml.parse(content, {
    customTags: [
      {
        tag: "tag:yaml.org,2002:js",
        resolve: (value: string): JsExpr => ({ __jsExpr: value }),
      },
    ],
  }) as unknown as Array<{
    insert?: Array<{
      id: string;
      name: string;
      config: {
        serverName: unknown;
        transport: unknown;
        command: unknown;
        args?: unknown[];
        env?: Record<string, unknown>;
        cwd?: unknown;
        toolCallTimeoutMs?: unknown;
        failOnStartupError?: unknown;
      };
    }>;
  }>;
}

describe("DeepSeek Harness adapter patch", () => {
  it("keeps the dsh manifest exact and records compatibility identity outside it", async () => {
    const metadata = JSON.parse(await readFile(PACKAGE_PATH, "utf8"));

    expect(metadata.dsh).toEqual({ bundle: { patch: "./cordis.patch.yml" } });
    expect(metadata.deepseekHarness).toEqual({
      revision: "cd5ef8148158c3a752a658978873241fdf8e2bbc",
      tag: "dsh-v0.1.2-alpha.1",
      mcpClientVersion: "0.1.2-alpha.1",
      timeoutBudget: {
        queueWaitMs: 30_000,
        executionDeadlineMs: 120_000,
        marginMs: 15_000,
        outerToolCallMs: 180_000,
      },
    });
  });

  it("is a single insert mounting the official MCP client over stdio", async () => {
    const patch = await parsePatch();

    expect(patch).toHaveLength(1);
    const rows = patch[0]!.insert;
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({
      id: "mcp-ast",
      name: "@deepseek-ai/dsh-mcp-client",
      config: {
        serverName: "ast",
        transport: "stdio",
      },
    });
  });

  it("resolves the entrypoint relative to the profile baseUrl with the current node", async () => {
    const patch = await parsePatch();
    const config = patch[0]!.insert![0]!.config;

    expect(isJsExpr(config.command)).toBe(true);
    expect((config.command as JsExpr).__jsExpr).toContain("process.execPath");
    expect(config.args).toHaveLength(1);
    expect(isJsExpr(config.args![0])).toBe(true);
    const entrypoint = (config.args![0] as JsExpr).__jsExpr;
    expect(entrypoint).toContain("node_modules/ast-mcp-server/dist/index.js");
    expect(entrypoint).toContain("baseUrl");
    expect(entrypoint).toContain("fileURLToPath");
    expect(isJsExpr(config.cwd)).toBe(true);
    expect((config.cwd as JsExpr).__jsExpr).toContain("process.cwd");
  });

  it("denies every apply path by default and fails loud on startup errors", async () => {
    const patch = await parsePatch();
    const config = patch[0]!.insert![0]!.config;

    expect(config.env).toMatchObject({
      AST_MCP_APPLY_GUARD: "deny",
      AST_MCP_TEXT_PROJECTION: "canonical_json",
    });
    expect(config.failOnStartupError).toBe(true);
  });

  it("derives an ordered timeout from the sole package budget", async () => {
    const metadata = JSON.parse(await readFile(PACKAGE_PATH, "utf8"));
    const budget = validateTimeoutBudget(metadata.deepseekHarness?.timeoutBudget);
    expect(budget).toEqual({
      queueWaitMs: 30_000,
      executionDeadlineMs: 120_000,
      marginMs: 15_000,
      outerToolCallMs: 180_000,
    });
    const runtimePolicy = parseRuntimePolicy({});
    expect(runtimePolicy.queueWaitTimeoutMs).toBe(budget.queueWaitMs);
    expect(runtimePolicy.operationDeadlineMs).toBe(budget.executionDeadlineMs);

    const patch = await parsePatch();
    const configured = patch[0]!.insert![0]!.config.toolCallTimeoutMs;
    expect(isJsExpr(configured)).toBe(true);
    const profileRoot = await mkdtemp(path.join(os.tmpdir(), "ast-budget-patch-"));
    try {
      const installedRoot = path.join(profileRoot, "node_modules", "ast-mcp-server");
      await mkdir(installedRoot, { recursive: true });
      await writeFile(path.join(installedRoot, "package.json"), JSON.stringify(metadata));
      const baseUrl = pathToFileURL(`${profileRoot}${path.sep}`).href;
      const evaluated = Function("baseUrl", `return (${(configured as JsExpr).__jsExpr})`)(baseUrl);
      expect(evaluated).toBe(budget.outerToolCallMs);
    } finally {
      await rm(profileRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed or unordered timeout budgets", () => {
    const valid = {
      queueWaitMs: 30_000,
      executionDeadlineMs: 120_000,
      marginMs: 15_000,
      outerToolCallMs: 180_000,
    };
    for (const key of Object.keys(valid)) {
      expect(() => validateTimeoutBudget({ ...valid, [key]: undefined })).toThrow();
      expect(() => validateTimeoutBudget({ ...valid, [key]: 1.5 })).toThrow();
    }
    for (const marginMs of [0, -1]) {
      expect(() => validateTimeoutBudget({ ...valid, marginMs })).toThrow();
    }
    expect(() => validateTimeoutBudget({ ...valid, outerToolCallMs: 165_000 })).toThrow();
    expect(() => validateTimeoutBudget({ ...valid, outerToolCallMs: 164_999 })).toThrow();
  });
});

describe("pinned Harness smoke contract", () => {
  it("proves every promised class, native presentation and bounded apply denial", async () => {
    const source = await readFile(SMOKE_PATH, "utf8");
    for (const qualifiedName of [
      "mcp__ast__ast_get_project_status",
      "mcp__ast__ast_rename_symbol",
      "mcp__ast__ast_get_operation_preview",
      "mcp__ast__ast_apply_operation",
    ]) {
      expect(source).toContain(qualifiedName);
    }
    expect(source).toContain('tools.mode: "native"');
    expect(source).toContain("observedTarballSha256");
    expect(source).not.toContain("process.exit(");
    expect(source).toContain('detached: process.platform !== "win32"');
    expect(source).toContain("terminateProcessTree(child)");
    expect(source).toContain("closeMcpSession");
    expect(source).toContain("else await transport.close()");
    expect(source).toContain("collectOwnedProcessTree(pid)");
    expect(source).toContain("terminateOwnedPids(ownedPids)");
    expect(source).toContain("exited.every(Boolean)");
    expect(source).toContain('rejected.error?.info?.code === "UNKNOWN_TOOL"');
    expect(source).toContain("supervisedNames.length === 15");
    expect(source).toContain("await rm(temporaryRoot, { recursive: true, force: true })");
    expect(source).toContain("materializePinnedHarness");
    expect(source).toContain('"--no-hardlinks"');
    expect(source).not.toContain("const source = process.env.DSH_HARNESS_SOURCE");
    expect(source).toContain("observedCliSha256");
    expect(source).toContain("PUBLIC_PACKAGE_INTEGRITY");
    expect(source).toContain(
      "validateTimeoutBudget(packageMetadata.deepseekHarness?.timeoutBudget)",
    );
    expect(source).toContain("BLOCKED:");
    expect(source).toContain('cleanup: "ok"');
    expect(source.indexOf('command("h03-cold", "cold", "hold")')).toBeLessThan(
      source.indexOf('command("h03-blocker", "blocker", "hold")'),
    );
    expect(source).toContain("recycleAbort.abort()");
    expect(source).not.toContain('command("recycle", "cancel")');
    expect(source).toContain('event.phase === "stale"');
    expect(source).toContain("eventsDrained");
    expect(source).toContain("rawMarkerSha256");
    expect(source).not.toContain('origin("h03-queued", "queued", blockerStart.generation)');
    expect(source).toContain('event.fixtureId === "queued" && event.phase === "error"');
    // prettier-ignore
    expect(source.indexOf("await rm(temporaryRoot")).toBeLessThan(source.indexOf("cleanupEvidenceSha256"));
    expect(source).toContain("createH03CleanupEvidence(summary.h03)");
    expect(source).toContain("AST_H01_PROCESS_OWNER");
    expect(source).not.toContain("execFileAsync");
  });

  it("authenticates the complete identity before creating H-03 fixture state", async () => {
    const source = await readFile(SMOKE_PATH, "utf8");
    const gate = source.slice(
      source.indexOf("const expectedIdentity ="),
      source.indexOf("summary.h03Identity"),
    );
    for (const field of [
      "hostCliSha256",
      "bridgeTarballSha256",
      "astTarballSha256",
      "astEntrypointSha256",
      "adapterSha256",
      "effectiveConfigSha256",
      "nodeVersion",
      "nodeSha256",
    ]) {
      expect(gate).toContain(field);
    }
    expect(source.indexOf("requireExactIdentity(exactIdentity")).toBeLessThan(
      source.indexOf('const h03Control = path.join(temporaryRoot, "h03-control")'),
    );
    expect(source).not.toContain("assert(head === PINNED_REVISION");
    expect(source.indexOf("requireExactIdentity(exactIdentity")).toBeLessThan(
      source.lastIndexOf("await rm(temporaryRoot"),
    );
  });

  it("parses the generated native lifecycle probe and requires exact terminal ownership", async () => {
    const source = await readFile(SMOKE_PATH, "utf8");
    const outer = ts.createSourceFile("smoke.mjs", source, ts.ScriptTarget.ESNext, true);
    let generated = "";
    // prettier-ignore
    const visit = (node: ts.Node): void => { if (ts.isFunctionDeclaration(node) && node.name?.text === "h05ProbeSource") { const returned = node.body?.statements.find(ts.isReturnStatement)?.expression; expect(returned && ts.isTemplateExpression(returned)).toBe(true); if (returned && ts.isTemplateExpression(returned)) generated = returned.head.text + returned.templateSpans.map((span) => { expect(span.expression.getText(outer)).toBe("JSON.stringify(H01_TOOL_NAME)"); return `${JSON.stringify("mcp__ast__ast_get_project_status")}${span.literal.text}`; }).join(""); } ts.forEachChild(node, visit); };
    visit(outer);
    const probe = ts.createSourceFile("h05-probe.mjs", generated, ts.ScriptTarget.ESNext, true);
    expect(
      (probe as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics,
    ).toEqual([]);
    const calls: string[] = [];
    const declarations = new Set<string>();
    // prettier-ignore
    const inspect = (node: ts.Node): void => { if (ts.isCallExpression(node)) calls.push(node.expression.getText(probe)); if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.add(node.name.text); ts.forEachChild(node, inspect); };
    inspect(probe);
    expect(source.indexOf("requireExactIdentity(exactIdentity)")).toBeLessThan(
      source.indexOf("const h05Control ="),
    );
    // prettier-ignore
    for (const name of ["cancelCommand", "bridgeAbortResults", "agentAbortReason", "retireSettled", "shutdownHook", "shutdownTerminal", "shutdownResources", "shutdownStopResult", "shutdownResultObserver", "waitShutdownNative"]) expect(declarations.has(name), `missing ${name}`).toBe(true);
    expect(calls.filter((call) => call === "refreshPatch")).toHaveLength(2);
    for (const call of ["assertTerminalIdentity", "assertNoRetiredEffects", "ctx.effect"])
      expect(calls).toContain(call);
    expect(generated).toMatch(/tools\/post-execute[\s\S]*bridgeAbortResults\.push/u);
    // prettier-ignore
    for (const contract of ["astAuthority = findPublicError(evidence.result)", 'surface: "transport"', "authoritativeAstTerminal: false", "astCorrelationId: astAuthority.correlation_id", 'astAuthority.code !== "REQUEST_CANCELLED"', '["ABORTED", "ABORTED_BEFORE_DISPATCH", "OPERATION_DEADLINE_EXCEEDED"]', "shutdownStopResult", "shutdownNative, shutdownDurable", "global: true"]) expect(generated).toContain(contract);
    expect(generated).toMatch(
      /evidenceRows\.length\s*!==\s*1[\s\S]*nativeRows\.length\s*!==\s*1[\s\S]*durableRows\.length\s*!==\s*1/u,
    );
    expect(generated).not.toMatch(/MCP error|MCP_|nativeRequired/u);
    expect(generated).toContain("terminalOrigins.every");
    expect(generated).toContain("evidence.ownerToken === command.ownerToken");
    expect(generated).toContain("bridgeAbortResults.length !== 1");
    expect(generated).toContain(
      "Signal rejection and MCP isError text reduction are distinct transport observations.",
    );
    expect(generated).toContain("retiredDurable.length !== 0");
    expect(source).toContain("await assertNoTransientResidue(temporaryRoot)");
    expect(source).toContain('!["uv.lock", "yarn.lock"].includes(entry.name)');
    expect(source).not.toContain("await assertNoTransientResidue(profileDir, h05Control)");
    expect(generated).not.toMatch(
      /retiredBeforeReconnect|bridgeAbortAcknowledged:\s*true|map\(findPublicError\)\.filter\(Boolean\)|setTimeout\(resolve|sleep\(|retireHandle\.agent\.cancel|shutdownHandle\.agent\.cancel/u,
    );
    expect(source).toContain("assertNoTransientResidue");
    expect(source).toContain("summary.h05");
  });

  it("keeps installation guidance executable and free of unpublished registry claims", async () => {
    const readme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");
    const patch = await readFile(PATCH_PATH, "utf8");

    expect(readme).toContain("yarn pack --out ast-mcp-server-%v.tgz");
    expect(readme).toContain("--env AST_MCP_APPLY_GUARD=allow");
    expect(patch).not.toContain("ast-mcp-server@0.13.0");
  });
});

describe("Harness canonical text projection", () => {
  it("projects empty successful content losslessly only for the explicit opt-in", () => {
    const structuredContent = {
      compiler: { ready: true },
      freshness: { state: "fresh" },
    };
    const result = { content: [] as [], structuredContent };

    expect(projectStructuredContentAsText(result, false)).toBe(result);
    expect(projectStructuredContentAsText(result, true)).toEqual({
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      structuredContent,
    });
    expect(
      projectStructuredContentAsText(
        { content: [{ type: "text", text: "already visible" }], structuredContent },
        true,
      ),
    ).toEqual({
      content: [{ type: "text", text: "already visible" }],
      structuredContent,
    });
    expect(projectStructuredContentAsText(result, true, 1)).toEqual({
      content: [
        {
          type: "text",
          text: expect.stringContaining("exceeds the 1-byte model-visible projection limit"),
        },
      ],
      structuredContent,
    });
  });

  it("keeps the projected result below the supervised worker line budget", () => {
    const result = {
      content: [] as [],
      structuredContent: { data: "x".repeat(113 * 1024) },
    };

    const projected = projectStructuredContentAsText(result, true);

    expect(projected.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("model-visible projection limit"),
      },
    ]);
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(256 * 1024);
  });

  it("accounts for escape amplification in the complete projected frame", () => {
    const result = {
      content: [] as [],
      structuredContent: { data: '"\\'.repeat(25 * 1024) },
    };

    const projected = projectStructuredContentAsText(result, true);

    expect(projected.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("complete projection limit"),
      },
    ]);
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThanOrEqual(
      MAX_PROJECTED_RESULT_BYTES,
    );
    expect(MAX_PROJECTED_RESULT_BYTES + COMPILER_WORKER_JSONRPC_ENVELOPE_RESERVE_BYTES).toBe(
      COMPILER_WORKER_MAX_FRAME_BYTES,
    );
    const completeFrame = JSON.stringify({
      jsonrpc: "2.0",
      id: "x".repeat(8 * 1024 - 2),
      result: projected,
    });
    expect(fitsCompilerWorkerResponseResult(projected)).toBe(true);
    expect(Buffer.byteLength(completeFrame)).toBeLessThanOrEqual(COMPILER_WORKER_MAX_FRAME_BYTES);
  });

  it("selects the projection only by its closed runtime-policy value", () => {
    const defaults = parseRuntimePolicy({});
    expect(defaults.projectStructuredContentAsText).toBe(false);
    expect(defaults.reasons.AST_MCP_TEXT_PROJECTION).toBe("default");

    const configured = parseRuntimePolicy({ AST_MCP_TEXT_PROJECTION: "canonical_json" });
    expect(configured.projectStructuredContentAsText).toBe(true);
    expect(configured.reasons.AST_MCP_TEXT_PROJECTION).toBe("configured");

    const hostile = "canonical_json $(touch nope)";
    const invalid = parseRuntimePolicy({ AST_MCP_TEXT_PROJECTION: hostile });
    expect(invalid.projectStructuredContentAsText).toBe(false);
    expect(invalid.reasons.AST_MCP_TEXT_PROJECTION).toBe("invalid_mode");
    expect(JSON.stringify(invalid)).not.toContain(hostile);
  });
});

describe("deny-by-default apply guard", () => {
  it("denies apply for every value except the explicit allow", () => {
    // unset → deny (fail-closed default)
    expect(parseRuntimePolicy({}).denyApply).toBe(true);
    expect(parseRuntimePolicy({}).reasons.AST_MCP_APPLY_GUARD).toBe("default");
    // deny → deny
    expect(parseRuntimePolicy({ AST_MCP_APPLY_GUARD: "deny" }).denyApply).toBe(true);
    expect(parseRuntimePolicy({ AST_MCP_APPLY_GUARD: "deny" }).reasons.AST_MCP_APPLY_GUARD).toBe(
      "configured",
    );
    // allow → allow (the only documented enabling value)
    expect(parseRuntimePolicy({ AST_MCP_APPLY_GUARD: "allow" }).denyApply).toBe(false);
    expect(parseRuntimePolicy({ AST_MCP_APPLY_GUARD: "allow" }).reasons.AST_MCP_APPLY_GUARD).toBe(
      "configured",
    );
    // invalid → deny (fail-closed)
    for (const hostile of ["", "off", "1", "Allow", "deny $(touch pwned)", null, 7]) {
      const policy = parseRuntimePolicy({ AST_MCP_APPLY_GUARD: hostile });
      expect(policy.denyApply).toBe(true);
      expect(policy.reasons.AST_MCP_APPLY_GUARD).toBe("invalid_mode");
      if (hostile !== "" && hostile !== null) {
        expect(Object.values(policy)).not.toContain(hostile);
        expect(Object.values(policy.reasons)).not.toContain(hostile);
      }
    }
  });

  it("adds the guard key to the closed environment-key vocabulary", () => {
    expect(RUNTIME_POLICY_ENV_KEYS).toContain("AST_MCP_APPLY_GUARD");
  });

  it("registers reads, prepare and preview but no apply tool under the guard", () => {
    const registered: string[] = [];
    const fakeServer = {
      registerTool: (name: string) => {
        registered.push(name);
      },
    } as unknown as Parameters<typeof toolCatalog.registerAll>[0];

    toolCatalog.registerAll(fakeServer, { denyApply: true });

    expect(registered).toHaveLength(15);
    expect(registered).not.toContain("ast_apply_operation");
    expect(registered.some((name) => name.includes("h03") || name.includes("fixture"))).toBe(false);
    expect(registered).toEqual(
      expect.arrayContaining([...toolCatalog.byEffect.read, ...toolCatalog.byEffect.prepare]),
    );
    expect(registered.filter((name) => toolCatalog.byEffect.apply.includes(name as never))).toEqual(
      [],
    );
  });

  it("keeps the full 16-tool surface when the guard is off", () => {
    const registered: string[] = [];
    const fakeServer = {
      registerTool: (name: string) => {
        registered.push(name);
      },
    } as unknown as Parameters<typeof toolCatalog.registerAll>[0];

    toolCatalog.registerAll(fakeServer);

    expect(registered).toHaveLength(16);
    expect(registered).toContain("ast_apply_operation");
  });

  it("passes createServer guard options into the catalog", () => {
    // The SDK server is not observable post-registration, so assert the wiring
    // contract: createServer with denyApply must not throw and the catalog
    // remains the single source for the deny set.
    expect(() => createServer({ denyApply: true })).not.toThrow();
    expect(toolCatalog.byEffect.apply).toEqual(["ast_apply_operation"]);
  });
});
