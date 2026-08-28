import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyOpenCodeConfigPlan,
  planOpenCodeConfig,
  resolveOpenCodeConfigPath,
  withIsolatedOpenCodeConfig,
} from "../src/services/opencode-config.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(directories.splice(0).map((item) => rm(item, { recursive: true, force: true }))),
);

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"));
  directories.push(directory);
  return directory;
}

describe("OpenCode routed configuration", () => {
  it("uses explicit file, then config directory, then the standard path", () => {
    expect(
      resolveOpenCodeConfigPath(
        { OPENCODE_CONFIG: "/custom/config.json", OPENCODE_CONFIG_DIR: "/ignored" },
        "/home/a",
      ),
    ).toBe("/custom/config.json");
    expect(resolveOpenCodeConfigPath({ OPENCODE_CONFIG_DIR: "/custom" }, "/home/a")).toBe(
      "/custom/opencode.json",
    );
    expect(resolveOpenCodeConfigPath({}, "/home/a")).toBe("/home/a/.config/opencode/opencode.json");
  });

  it("preserves JSONC comments, unrelated data, and mode while changing only mcp.ast", async () => {
    const root = await temporaryDirectory();
    const file = path.join(root, "opencode.json");
    await writeFile(
      file,
      '{\n  // keep this\n  "theme": "dark",\n  "mcp": { "other": { "type": "remote", "url": "https://example.test" } }\n}\n',
    );
    await chmod(file, 0o640);
    const plan = await planOpenCodeConfig({
      filePath: file,
      nodeExecutable: "/node",
      serverEntryPath: "/pkg/dist/index.js",
    });
    await applyOpenCodeConfigPlan(plan);
    const content = await readFile(file, "utf8");
    expect(content).toContain("// keep this");
    expect(content).toContain('"theme": "dark"');
    expect(content).toContain('"other"');
    expect(content).toContain('"command": [');
    expect(content).toContain('"environment"');
    expect(content).toContain('"AST_MCP_APPLY_GUARD"');
    expect(content).not.toContain("opencode mcp add");
    expect((await stat(file)).mode & 0o777).toBe(0o640);
  });

  it("isolates distinct explicit-file and config-directory authorities without merging bytes", async () => {
    const root = await temporaryDirectory();
    const selected = path.join(root, "selected", "custom.json");
    const routedDirectory = path.join(root, "routed");
    const routed = path.join(routedDirectory, "opencode.json");
    await mkdir(path.dirname(selected), { recursive: true });
    await mkdir(routedDirectory, { recursive: true });
    await writeFile(selected, '{"selected":true}\n');
    await writeFile(routed, '{"routed":true}\n');

    await withIsolatedOpenCodeConfig(
      { OPENCODE_CONFIG: selected, OPENCODE_CONFIG_DIR: routedDirectory },
      root,
      async (environment) => {
        expect(await readFile(environment.OPENCODE_CONFIG!, "utf8")).toBe('{"selected":true}\n');
        expect(
          await readFile(path.join(environment.OPENCODE_CONFIG_DIR!, "opencode.json"), "utf8"),
        ).toBe('{"routed":true}\n');
        await writeFile(environment.OPENCODE_CONFIG!, "mutated selected\n");
        await writeFile(
          path.join(environment.OPENCODE_CONFIG_DIR!, "opencode.json"),
          "mutated routed\n",
        );
      },
    );

    expect(await readFile(selected, "utf8")).toBe('{"selected":true}\n');
    expect(await readFile(routed, "utf8")).toBe('{"routed":true}\n');
  });

  it("rejects conflicts and concurrent changes without clobbering", async () => {
    const root = await temporaryDirectory();
    const file = path.join(root, "opencode.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{"mcp":{"ast":{"type":"local","command":["wrong"]}}}\n');
    await expect(
      planOpenCodeConfig({ filePath: file, nodeExecutable: "/node", serverEntryPath: "/server" }),
    ).rejects.toThrow(/conflict/i);
    await writeFile(file, "{}\n");
    const plan = await planOpenCodeConfig({
      filePath: file,
      nodeExecutable: "/node",
      serverEntryPath: "/server",
    });
    await writeFile(file, '{"changed":true}\n');
    await expect(applyOpenCodeConfigPlan(plan)).rejects.toThrow(/concurrently/i);
    expect(await readFile(file, "utf8")).toBe('{"changed":true}\n');
  });

  it("rejects malformed JSONC before creating an edit", async () => {
    const root = await temporaryDirectory();
    const file = path.join(root, "opencode.json");
    const malformed = '{"theme":"dark", "mcp": {"other": true}, trailing}\n';
    await writeFile(file, malformed);

    await expect(
      planOpenCodeConfig({ filePath: file, nodeExecutable: "/node", serverEntryPath: "/server" }),
    ).rejects.toThrow(/parseable/i);
    expect(await readFile(file, "utf8")).toBe(malformed);
  });
});
