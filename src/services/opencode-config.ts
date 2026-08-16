import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
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

export async function withIsolatedOpenCodeConfig<T>(
  environment: NodeJS.ProcessEnv,
  homeDirectory: string,
  operation: (isolatedEnvironment: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const selectedConfig = resolveOpenCodeConfigPath(environment, homeDirectory);
  const routedDirectory = path.resolve(
    environment.OPENCODE_CONFIG_DIR ?? path.join(homeDirectory, ".config", "opencode"),
  );
  const routedConfig = path.join(routedDirectory, "opencode.json");
  const readConfig = async (filePath: string): Promise<string> => {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "{}\n";
      throw error;
    }
  };
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ast-opencode-preflight-"));
  const temporaryRoutedDirectory = path.join(temporaryRoot, "config-dir");
  const temporaryRoutedConfig = path.join(temporaryRoutedDirectory, "opencode.json");
  const selectedAndRoutedAreSame = selectedConfig === routedConfig;
  const temporarySelectedConfig = selectedAndRoutedAreSame
    ? temporaryRoutedConfig
    : path.join(temporaryRoot, "selected", path.basename(selectedConfig));
  try {
    await mkdir(path.dirname(temporarySelectedConfig), { recursive: true });
    await mkdir(temporaryRoutedDirectory, { recursive: true });
    await writeFile(temporarySelectedConfig, await readConfig(selectedConfig), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    if (!selectedAndRoutedAreSame) {
      await writeFile(temporaryRoutedConfig, await readConfig(routedConfig), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    }
    return await operation({
      ...environment,
      OPENCODE_CONFIG: temporarySelectedConfig,
      OPENCODE_CONFIG_DIR: temporaryRoutedDirectory,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
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
  try {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", plan.mode);
      await handle.writeFile(plan.content, { encoding: "utf8" });
      await handle.chmod(plan.mode);
      await handle.sync();
      const staged = await handle.stat();
      if ((staged.mode & 0o777) !== plan.mode) {
        throw new Error("OpenCode configuration mode could not be preserved.");
      }
    } finally {
      await handle?.close();
    }
    if (!plan.beforeExists) {
      await link(temporary, plan.filePath);
      await rm(temporary);
    } else await rename(temporary, plan.filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}
