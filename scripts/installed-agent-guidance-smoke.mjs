#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repositoryRoot, "dist", "cli.js");
const agentOrder = ["claude", "hermes", "opencode", "codex", "gemini", "copilot"];
const guidanceAgents = new Set(["claude", "opencode", "codex", "gemini"]);
const marker = "<!-- ast-tool:structural-code-editing guidance v1 begin -->";
const hermesSoulSentinel = "# Existing Hermes identity\n\nPreserve this file byte-for-byte.\n";

function fail(message) {
  throw new Error(message);
}

function collectStrings(value, result = []) {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, result));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, result));
  }
  return result;
}

async function executableOnPath(name) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }
  return undefined;
}

async function execute(command, args, options) {
  try {
    return await executeFile(command, args, {
      ...options,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    });
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout.slice(0, 1000) : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr.slice(0, 1000) : "";
    throw new Error(
      `${path.basename(command)} ${args.join(" ")} failed (${error?.code ?? "unknown"}): ${stdout}${stderr}`,
      { cause: error },
    );
  }
}

async function assertMarker(filePath, label) {
  const content = await readFile(filePath, "utf8");
  if (content.split(marker).length !== 2)
    fail(`${label} does not contain exactly one managed block.`);
  return content;
}

async function assertMissing(filePath, label) {
  try {
    await access(filePath);
    fail(`${label} was created unexpectedly: ${filePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const root = await mkdtemp(path.join(os.tmpdir(), "ast-installed-guidance-smoke-"));
try {
  const home = path.join(root, "home");
  const claudeRoot = path.join(root, "claude");
  const hermesRoot = path.join(root, "hermes");
  const openCodeRoot = path.join(root, "opencode");
  const codexRoot = path.join(root, "codex");
  const openCodeConfig = path.join(openCodeRoot, "opencode.json");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(claudeRoot, { recursive: true }),
    mkdir(hermesRoot, { recursive: true }),
    mkdir(openCodeRoot, { recursive: true }),
    mkdir(codexRoot, { recursive: true }),
  ]);
  await writeFile(path.join(claudeRoot, "CLAUDE.md"), "# Installed smoke human rules\n", "utf8");
  await writeFile(path.join(hermesRoot, "SOUL.md"), hermesSoulSentinel, "utf8");
  await writeFile(openCodeConfig, "{}\n", "utf8");
  await writeFile(path.join(codexRoot, "AGENTS.override.md"), "# Codex override\n", "utf8");

  const executables = Object.fromEntries(
    await Promise.all(agentOrder.map(async (agent) => [agent, await executableOnPath(agent)])),
  );
  const installed = agentOrder.filter((agent) => executables[agent] !== undefined);
  if (installed.length === 0) fail("No supported clients are installed on PATH.");

  const environment = {
    HOME: home,
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? process.env.LANG ?? "C.UTF-8",
    CLAUDE_CONFIG_DIR: claudeRoot,
    HERMES_HOME: hermesRoot,
    OPENCODE_CONFIG: openCodeConfig,
    OPENCODE_CONFIG_DIR: openCodeRoot,
    CODEX_HOME: codexRoot,
    NO_COLOR: "1",
    CI: "1",
  };
  const selected = installed.join(",");
  const first = JSON.parse(
    (
      await execute(process.execPath, [cliPath, "setup", "--agents", selected, "--yes"], {
        cwd: repositoryRoot,
        env: environment,
      })
    ).stdout,
  );
  const second = JSON.parse(
    (
      await execute(process.execPath, [cliPath, "setup", "--agents", selected, "--yes"], {
        cwd: repositoryRoot,
        env: environment,
      })
    ).stdout,
  );
  if (first.version !== 2 || first.agents.length !== installed.length) {
    fail("First installed-client setup did not return schema v2 for every selected client.");
  }
  if (!Array.isArray(second.physical_writes) || second.physical_writes.length !== 0) {
    fail("Installed-client setup replay performed physical writes.");
  }

  const evidence = [];
  for (const item of first.agents) {
    const replay = second.agents.find((candidate) => candidate.agent === item.agent);
    if (!replay || replay.mcp !== "unchanged" || replay.skill !== "unchanged") {
      fail(`${item.agent} did not converge on replay.`);
    }
    if (guidanceAgents.has(item.agent)) {
      if (!["installed", "updated"].includes(item.guidance) || replay.guidance !== "unchanged") {
        fail(`${item.agent} managed guidance did not converge.`);
      }
    } else if (item.guidance !== "skill_only" || replay.guidance !== "skill_only") {
      fail(`${item.agent} did not remain skill_only.`);
    }
  }

  if (installed.includes("claude")) {
    const content = await assertMarker(path.join(claudeRoot, "CLAUDE.md"), "Claude guidance");
    if (!content.startsWith("# Installed smoke human rules\n")) fail("Claude human rules changed.");
    const mcp = await execute(executables.claude, ["mcp", "get", "ast"], {
      cwd: repositoryRoot,
      env: environment,
    });
    if (!/Connected/i.test(mcp.stdout))
      fail("Claude did not discover the isolated ast MCP server.");
    evidence.push({ agent: "claude", guidance: "native_path", mcp: "client_discovery" });
  }
  if (installed.includes("opencode")) {
    const guidancePath = installed.includes("claude")
      ? path.join(claudeRoot, "CLAUDE.md")
      : path.join(openCodeRoot, "AGENTS.md");
    await assertMarker(guidancePath, "OpenCode guidance");
    const resolved = JSON.parse(
      (
        await execute(executables.opencode, ["debug", "config", "--pure"], {
          cwd: repositoryRoot,
          env: environment,
        })
      ).stdout,
    );
    if (resolved?.mcp?.ast?.command?.[1] !== path.join(repositoryRoot, "dist", "index.js")) {
      fail("OpenCode did not resolve the isolated ast MCP configuration.");
    }
    evidence.push({
      agent: "opencode",
      guidance: installed.includes("claude") ? "shared_claude_fallback" : "native_path",
      mcp: "client_discovery",
    });
  }
  if (installed.includes("codex")) {
    const guidancePath = path.join(codexRoot, "AGENTS.override.md");
    const guidance = await assertMarker(guidancePath, "Codex guidance");
    const promptInput = await execute(executables.codex, ["debug", "prompt-input"], {
      cwd: repositoryRoot,
      env: environment,
    });
    const modelVisibleStrings = collectStrings(JSON.parse(promptInput.stdout));
    if (!modelVisibleStrings.some((value) => value.includes(guidance.trim()))) {
      fail("Codex model-visible prompt input did not contain the managed guidance.");
    }
    const mcp = JSON.parse(
      (
        await execute(executables.codex, ["mcp", "get", "ast", "--json"], {
          cwd: repositoryRoot,
          env: environment,
        })
      ).stdout,
    );
    if (mcp?.transport?.args?.[0] !== path.join(repositoryRoot, "dist", "index.js")) {
      fail("Codex did not discover the isolated ast MCP server.");
    }
    evidence.push({ agent: "codex", guidance: "client_discovery", mcp: "client_discovery" });
  }
  if (installed.includes("gemini")) {
    await assertMarker(path.join(home, ".gemini", "GEMINI.md"), "Gemini guidance");
    evidence.push({ agent: "gemini", guidance: "native_path", mcp: "client_discovery" });
  }
  if (installed.includes("hermes")) {
    const hermesSoul = await readFile(path.join(hermesRoot, "SOUL.md"), "utf8");
    if (hermesSoul !== hermesSoulSentinel) fail("Hermes SOUL.md changed.");
    await assertMarker(
      path.join(
        hermesRoot,
        "skills",
        "software-development",
        "structural-code-editing",
        "SKILL.md",
      ),
      "Hermes skill marker probe",
    ).catch(async (error) => {
      const skill = await readFile(
        path.join(
          hermesRoot,
          "skills",
          "software-development",
          "structural-code-editing",
          "SKILL.md",
        ),
        "utf8",
      );
      if (!skill.includes("name: structural-code-editing")) throw error;
    });
    evidence.push({ agent: "hermes", guidance: "skill_only", mcp: "client_discovery" });
  }
  if (installed.includes("copilot")) {
    await assertMissing(path.join(home, ".copilot", "AGENTS.md"), "Copilot invented guidance");
    const skill = await readFile(
      path.join(home, ".agents", "skills", "structural-code-editing", "SKILL.md"),
      "utf8",
    );
    if (!skill.includes("name: structural-code-editing")) fail("Copilot shared skill is missing.");
    const mcp = JSON.parse(
      (
        await execute(executables.copilot, ["mcp", "get", "ast", "--json"], {
          cwd: repositoryRoot,
          env: environment,
        })
      ).stdout,
    );
    if (mcp?.ast?.args?.[0] !== path.join(repositoryRoot, "dist", "index.js")) {
      fail("Copilot did not discover the isolated ast MCP server.");
    }
    evidence.push({ agent: "copilot", guidance: "skill_only", mcp: "client_discovery" });
  }

  process.stdout.write(
    `${JSON.stringify({ schema_version: 1, status: "pass", installed, unavailable: agentOrder.filter((agent) => !installed.includes(agent)), evidence })}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
