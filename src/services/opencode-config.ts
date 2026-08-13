import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

export interface OpenCodeConfigPlan {
  filePath: string;
  beforeHash: string;
  beforeExists: boolean;
  mode: number;
  content: string;
  status: "installed" | "unchanged";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function resolveOpenCodeConfigPath(
  environment: NodeJS.ProcessEnv,
  homeDirectory: string,
): string {
  if (environment.OPENCODE_CONFIG) return path.resolve(environment.OPENCODE_CONFIG);
  if (environment.OPENCODE_CONFIG_DIR)
    return path.resolve(environment.OPENCODE_CONFIG_DIR, "opencode.json");
  return path.join(homeDirectory, ".config", "opencode", "opencode.json");
}

export async function planOpenCodeConfig(options: {
  filePath: string;
  nodeExecutable: string;
  serverEntryPath: string;
}): Promise<OpenCodeConfigPlan> {
  let before = "{}\n";
  let beforeExists = true;
  let mode = 0o600;
  try {
    before = await readFile(options.filePath, "utf8");
    mode = (await stat(options.filePath)).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") beforeExists = false;
    else throw error;
  }
  const parseErrors: ParseError[] = [];
  const parsed: any = parse(before, parseErrors);
  if (parseErrors.length > 0) {
    throw new Error("OpenCode configuration is not parseable JSON/JSONC.");
  }
  if (!parsed || typeof parsed !== "object")
    throw new Error("OpenCode configuration must contain an object.");
  const desired = {
    type: "local",
    command: [options.nodeExecutable, options.serverEntryPath],
    enabled: true,
  };
  if (parsed.mcp?.ast !== undefined && JSON.stringify(parsed.mcp.ast) !== JSON.stringify(desired))
    throw new Error("OpenCode configuration conflict at mcp.ast.");
  const content =
    parsed.mcp?.ast === undefined
      ? applyEdits(
          before,
          modify(before, ["mcp", "ast"], desired, {
            formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
          }),
        )
      : before;
  return {
    filePath: options.filePath,
    beforeHash: hash(beforeExists ? before : ""),
    beforeExists,
    mode,
    content,
    status: content === before ? "unchanged" : "installed",
  };
}

export async function applyOpenCodeConfigPlan(plan: OpenCodeConfigPlan): Promise<void> {
  if (plan.status === "unchanged") return;
  let current = "";
  let exists = true;
  try {
    current = await readFile(plan.filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") exists = false;
    else throw error;
  }
  if (exists !== plan.beforeExists || hash(current) !== plan.beforeHash)
    throw new Error("OpenCode configuration changed concurrently; no file was replaced.");
  const directory = path.dirname(plan.filePath);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(plan.filePath)}.${randomUUID()}.tmp`);
  await writeFile(temporary, plan.content, { encoding: "utf8", flag: "wx", mode: plan.mode });
  try {
    if (!plan.beforeExists) {
      await link(temporary, plan.filePath);
      await rm(temporary);
    } else await rename(temporary, plan.filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}
