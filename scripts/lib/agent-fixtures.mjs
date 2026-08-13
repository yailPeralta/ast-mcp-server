import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SECRET_PATTERNS = [
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/,
  /\b(?:api[_-]?key|token|authorization)\s*[=:]\s*["']?[^\s,"'}]{8,}/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
];

function stableFixtureBytes(value) {
  const unsigned = { ...value };
  delete unsigned.sha256;
  return `${JSON.stringify(unsigned, null, 2)}\n`;
}

function digest(value) {
  return createHash("sha256").update(stableFixtureBytes(value)).digest("hex");
}

function replaceLiteral(value, literal, replacement) {
  return literal ? value.split(literal).join(replacement) : value;
}

export function normalizeAgentFixture(input) {
  const combined = JSON.stringify(input);
  if (SECRET_PATTERNS.some((pattern) => pattern.test(combined))) {
    throw new Error("Fixture output contains a possible secret and cannot be admitted.");
  }
  const home = os.homedir();
  const normalizeText = (value) =>
    replaceLiteral(
      replaceLiteral(value.replaceAll("\\", "/"), input.cwd, "<WORKING_DIRECTORY>"),
      home,
      "<HOME>",
    ).replace(/\/home\/[A-Za-z0-9._-]+(?=\/)/g, "<HOME>");
  const fixture = {
    schemaVersion: 1,
    agent: input.agent,
    operation: input.operation,
    version: input.version,
    command: input.command,
    cwd: "<WORKING_DIRECTORY>",
    exitCode: input.exitCode,
    stdout: normalizeText(input.stdout),
    stderr: normalizeText(input.stderr),
  };
  return { ...fixture, sha256: digest(fixture) };
}

export async function admitAgentFixture(directory, input) {
  const fixture = normalizeAgentFixture(input);
  const fileName = `${fixture.agent}-${fixture.operation}.json`;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, fileName), `${JSON.stringify(fixture, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { fileName, fixture };
}

export async function verifyAgentFixtureDirectory(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  for (const name of names) {
    const bytes = await readFile(path.join(directory, name), "utf8");
    let fixture;
    try {
      fixture = JSON.parse(bytes);
    } catch {
      throw new Error(`Fixture drift: ${name} is not valid JSON.`);
    }
    if (fixture.sha256 !== digest(fixture)) {
      throw new Error(`Fixture drift detected for ${name}.`);
    }
  }
  return { checked: names.length };
}
