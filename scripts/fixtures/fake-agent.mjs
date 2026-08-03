#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import console from "node:console";
import process from "node:process";

const executableName = path.basename(process.argv[1]).replace(/\.(?:cmd|exe)$/i, "");
const args = process.argv.slice(2);
const isClaude = executableName === "claude";
const statePath = isClaude ? process.env.FAKE_CLAUDE_STATE : process.env.FAKE_HERMES_STATE;

if (!statePath) {
  console.error(`Missing fake state path for ${executableName}.`);
  process.exit(2);
}

const readState = () =>
  fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : null;
const writeState = (value) => fs.writeFileSync(statePath, JSON.stringify(value));

if (args[0] === "--version") {
  console.log(isClaude ? "2.1.201 (Claude Code)" : "Hermes Agent v0.17.0");
  process.exit(0);
}

if (isClaude && args[0] === "mcp" && args[1] === "get") {
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

if (isClaude && args[0] === "mcp" && args[1] === "add") {
  const separator = args.indexOf("--");
  writeState({ command: args[separator + 1], entry: args[separator + 2] });
  console.log("Added stdio MCP server ast");
  process.exit(0);
}

if (!isClaude && args[0] === "mcp" && args[1] === "list") {
  console.log(readState() ? "ast  stdio  all  ✓ enabled" : "No MCP servers configured.");
  process.exit(0);
}

if (!isClaude && args[0] === "mcp" && args[1] === "test") {
  const state = readState();
  if (!state || state.conflict) {
    console.error("Failed to connect");
    process.exit(1);
  }
  console.log(`Testing 'ast'...
  ✓ Connected
  ✓ Tools discovered: 10
  ast_list_files
  ast_get_outline
  ast_get_symbol_source
  ast_search_symbols
  ast_find_references
  ast_get_diagnostics
  ast_rename_symbol
  ast_replace_symbol_body
  ast_get_operation_preview
  ast_apply_operation`);
  process.exit(0);
}

if (!isClaude && args[0] === "mcp" && args[1] === "add") {
  const commandIndex = args.indexOf("--command");
  const argsIndex = args.indexOf("--args");
  writeState({ command: args[commandIndex + 1], entry: args[argsIndex + 1] });
  console.log("✓ Saved 'ast' (10/10 tools enabled)");
  process.exit(0);
}

console.error(`Unsupported fake command: ${executableName} ${args.join(" ")}`);
process.exit(2);
