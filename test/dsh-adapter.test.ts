import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import yaml from "yaml";
import { createServer } from "../src/server.js";
import { RUNTIME_POLICY_ENV_KEYS, parseRuntimePolicy } from "../src/services/runtime-policy.js";
import { toolCatalog } from "../src/tools/catalog.js";

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

    expect(config.env).toMatchObject({ AST_MCP_APPLY_GUARD: "deny" });
    expect(config.failOnStartupError).toBe(true);
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
    expect(source).toContain("tarballSha256");
    expect(source).not.toContain("process.exit(");
    expect(source).toContain('detached: process.platform !== "win32"');
    expect(source).toContain("process.kill(-child.pid");
    expect(source).toContain('run("taskkill", ["/pid", String(child.pid), "/t", "/f"]');
    expect(source).toContain('child.kill("SIGKILL")');
    expect(source).toContain("await guardedClient.close().catch");
    expect(source).not.toContain("await client.close();");
    expect(source).toContain("await rm(temporaryRoot, { recursive: true, force: true })");
  });

  it("keeps installation guidance executable and free of unpublished registry claims", async () => {
    const readme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");
    const patch = await readFile(PATCH_PATH, "utf8");

    expect(readme).toContain("yarn pack --out ast-mcp-server-%v.tgz");
    expect(readme).toContain("--env AST_MCP_APPLY_GUARD=allow");
    expect(patch).not.toContain("ast-mcp-server@0.13.0");
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
