#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import console from "node:console";
import process from "node:process";

const executableName = path.basename(process.argv[1]).replace(/\.(?:cmd|exe)$/i, "");
const args = process.argv.slice(2);
const stateEnvironment = `FAKE_${executableName.toUpperCase()}_STATE`;
const statePath =
  process.env[stateEnvironment] ??
  (executableName === "fake-agent.mjs" ? process.env.FAKE_HERMES_STATE : undefined);

if (!statePath) {
  console.error(`Missing fake state path for ${executableName}.`);
  process.exit(2);
}

const readState = () =>
  fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : null;
const writeState = (value) => fs.writeFileSync(statePath, JSON.stringify(value));

if (args[0] === "--version") {
  const versions = {
    claude: "2.1.201 (Claude Code)",
    hermes: "Hermes Agent v0.17.0",
    opencode: "1.18.18",
    codex: "codex-cli 0.144.0",
    gemini: "0.39.1",
    copilot: "0.0.356",
  };
  console.log(
    versions[executableName] ?? (executableName === "fake-agent.mjs" ? versions.hermes : undefined),
  );
  process.exit(0);
}

if (executableName === "claude" && args[0] === "mcp" && args[1] === "get") {
  const state = readState();
  if (!state) {
    console.error('No MCP server named "ast".');
    process.exit(1);
  }
  console.log(`ast:
  Scope: User config (available in all your projects)
  Status: ✔ Connected
  Type: stdio
  Command: ${state.command}
  Args: ${state.entry}`);
  process.exit(0);
}

if (executableName === "claude" && args[0] === "mcp" && args[1] === "add") {
  const separator = args.indexOf("--");
  writeState({ command: args[separator + 1], entry: args[separator + 2] });
  console.log("Added stdio MCP server ast");
  process.exit(0);
}

if (executableName === "hermes" && args[0] === "mcp" && args[1] === "list") {
  console.log(readState() ? "ast  stdio  all  ✓ enabled" : "No MCP servers configured.");
  process.exit(0);
}

if (executableName === "hermes" && args[0] === "mcp" && args[1] === "test") {
  const state = readState();
  if (!state || state.conflict) {
    console.error("Failed to connect");
    process.exit(1);
  }
  console.log(`Testing 'ast'...
  ✓ Connected
  ✓ Tools discovered: 15
  ast_list_files
  ast_get_project_status
  ast_explore
  ast_get_outline
  ast_get_symbol_source
  ast_search_symbols
  ast_find_references
  ast_get_impact
  ast_get_diagnostics
  ast_get_file
  ast_rename_symbol
  ast_replace_symbol_body
  ast_scaffold_class
  ast_get_operation_preview
  ast_apply_operation`);
  process.exit(0);
}

if (executableName === "hermes" && args[0] === "mcp" && args[1] === "add") {
  const commandIndex = args.indexOf("--command");
  const argsIndex = args.indexOf("--args");
  writeState({ command: args[commandIndex + 1], entry: args[argsIndex + 1] });
  console.log("✓ Saved 'ast' (15/15 tools enabled)");
  process.exit(0);
}

if (
  (executableName === "codex" || executableName === "copilot") &&
  args[0] === "mcp" &&
  args[1] === "get"
) {
  const state = readState();
  if (!state) {
    console.error("No MCP server named 'ast' found.");
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      name: "ast",
      transport: { type: "stdio", command: state.command, args: [state.entry] },
    }),
  );
  process.exit(0);
}

if (
  (executableName === "codex" || executableName === "copilot") &&
  args[0] === "mcp" &&
  args[1] === "add"
) {
  const separator = args.indexOf("--");
  const commandIndex = args.indexOf("--command");
  const argsIndex = args.indexOf("--args");
  if (executableName === "copilot" && (separator < 0 || commandIndex >= 0 || argsIndex >= 0)) {
    console.error("Unsupported Copilot MCP add syntax.");
    process.exit(2);
  }
  writeState({ command: args[separator + 1], entry: args[separator + 2] });
  console.log("Added MCP server ast");
  process.exit(0);
}

if (executableName === "gemini" && args[0] === "mcp" && args[1] === "list") {
  const state = readState();
  console.log(
    state
      ? `ast Connected command: ${state.command}, args: [${state.entry}]`
      : "No MCP servers configured.",
  );
  process.exit(0);
}
if (executableName === "gemini" && args[0] === "mcp" && args[1] === "add") {
  writeState({ command: args[3], entry: args[4] });
  console.log("MCP server ast added.");
  process.exit(0);
}

if (executableName === "opencode" && args[0] === "debug" && args[1] === "config") {
  const configPath = process.env.OPENCODE_CONFIG;
  let config = "{}";
  if (configPath && fs.existsSync(configPath))
    config = fs.readFileSync(configPath, "utf8").replace(/\/\/.*$/gm, "");
  console.log(config);
  process.exit(0);
}
if (executableName === "opencode" && args[0] === "mcp" && args[1] === "list") {
  console.log("ast connected");
  process.exit(0);
}

console.error(`Unsupported fake command: ${executableName} ${args.join(" ")}`);
process.exit(2);
