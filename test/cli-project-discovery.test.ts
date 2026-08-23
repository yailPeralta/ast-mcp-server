import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseBatchDocument } from "../src/batch/runner.js";
import {
  CliProjectDiscoveryError,
  resolveCliBatchProject,
} from "../src/services/cli-project-discovery.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-cli-project-"));
  roots.push(root);
  return root;
}

function document(projectRoot?: string) {
  return {
    version: 1,
    ...(projectRoot === undefined ? {} : { project_root: projectRoot }),
    steps: [{ id: "search", tool: "ast_search_symbols", input: { query: "value" } }],
  };
}

describe("CLI project discovery", () => {
  it("discovers the nearest jsconfig from a nested cwd", async () => {
    const root = await fixture();
    const nested = path.join(root, "nested", "cwd");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, "jsconfig.json"), "{}");
    await expect(resolveCliBatchProject(document(), nested)).resolves.toMatchObject({
      project_root: path.join(root, "jsconfig.json"),
    });
  });

  it("chooses a nearer tsconfig over a farther config", async () => {
    const root = await fixture();
    const nested = path.join(root, "workspace", "src");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, "jsconfig.json"), "{}");
    await writeFile(path.join(root, "workspace", "tsconfig.json"), "{}");
    await expect(resolveCliBatchProject(document(nested), root)).resolves.toMatchObject({
      project_root: path.join(root, "workspace", "tsconfig.json"),
    });
  });

  it("preserves an explicit config when sibling configs are ambiguous", async () => {
    const root = await fixture();
    await Promise.all([
      writeFile(path.join(root, "tsconfig.json"), "{}"),
      writeFile(path.join(root, "jsconfig.json"), "{}"),
    ]);
    await expect(
      resolveCliBatchProject(document(path.join(root, "jsconfig.json")), root),
    ).resolves.toMatchObject({ project_root: path.join(root, "jsconfig.json") });
  });

  it("fails same-level ambiguity with an executable continuation", async () => {
    const root = await fixture();
    await Promise.all([
      writeFile(path.join(root, "tsconfig.json"), "{}"),
      writeFile(path.join(root, "jsconfig.json"), "{}"),
    ]);
    const error = await resolveCliBatchProject(document(), root).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "PROJECT_CONFIG_AMBIGUOUS",
      continuation: expect.stringContaining('project_root to "./tsconfig.json"'),
    });
    expect(JSON.stringify(error)).not.toContain(root);
  });

  it("stops at a repository boundary and rejects symlink escapes", async () => {
    const root = await fixture();
    const repo = path.join(root, "repo");
    const nested = path.join(repo, "nested");
    const outside = path.join(root, "outside");
    await Promise.all([
      mkdir(path.join(repo, ".git"), { recursive: true }),
      mkdir(nested, { recursive: true }),
      mkdir(outside),
      writeFile(path.join(root, "tsconfig.json"), "{}"),
      writeFile(path.join(outside, "jsconfig.json"), "{}"),
    ]);
    await expect(resolveCliBatchProject(document(), nested)).rejects.toMatchObject({
      code: "PROJECT_CONFIG_NOT_FOUND",
    });
    const link = path.join(repo, "linked");
    await symlink(outside, link, "dir");
    await expect(resolveCliBatchProject(document(link), repo)).rejects.toMatchObject({
      code: "PROJECT_CONFIG_UNSAFE",
    });
  });

  it("leaves deterministic MCP/batch project omission unchanged", () => {
    expect(() => parseBatchDocument(document())).toThrow();
    expect(CliProjectDiscoveryError).toBeTypeOf("function");
  });
});
