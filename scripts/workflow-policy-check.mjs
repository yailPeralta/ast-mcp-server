#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REQUIRED_WORKFLOWS = Object.freeze(["ci.yml", "release.yml", "security.yml"]);
const ALLOWED_ACTION_OWNERS = new Set(["actions", "github"]);
const REVIEWED_ACTION_REVISIONS = new Map([
  ["actions/checkout", { revision: "3d3c42e5aac5ba805825da76410c181273ba90b1", version: "v7.0.1" }],
  [
    "actions/setup-node",
    { revision: "820762786026740c76f36085b0efc47a31fe5020", version: "v7.0.0" },
  ],
  [
    "actions/dependency-review-action",
    { revision: "a1d282b36b6f3519aa1f3fc636f609c47dddb294", version: "v5.0.0" },
  ],
  [
    "github/codeql-action/init",
    { revision: "5595ccaf912efad79be6eef63a5619ff05969be3", version: "v4.37.6" },
  ],
  [
    "github/codeql-action/analyze",
    { revision: "5595ccaf912efad79be6eef63a5619ff05969be3", version: "v4.37.6" },
  ],
  [
    "actions/upload-artifact",
    { revision: "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", version: "v7.0.1" },
  ],
  [
    "actions/download-artifact",
    { revision: "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c", version: "v8.0.1" },
  ],
]);
const MAX_WORKFLOW_BYTES = 256 * 1024;
const MAX_JOB_TIMEOUT_MINUTES = 60;
const CI_RELEASE_GATES = Object.freeze([
  "node scripts/ci-prepare-gnu-mv.mjs prepare",
  "NODE_OPTIONS= corepack enable",
  "NODE_OPTIONS= yarn install --immutable",
  "NODE_OPTIONS= corepack enable",
  "yarn format:check",
  "yarn lint",
  "yarn typecheck",
  "yarn test",
  "yarn build",
  "yarn test:mcp",
  "yarn test:errors",
  "yarn test:lifecycle",
  "yarn test:cli",
  "yarn test:package",
  "yarn test:dsh-adapter",
  "yarn audit",
  "yarn pack --dry-run --json",
  "node scripts/workflow-policy-check.mjs",
  "git diff --check HEAD^ HEAD",
]);

function policyFailure(message) {
  throw new Error(`Workflow policy violation: ${message}`);
}

function validateCredentialReferences(source, workflowName) {
  const references =
    source.match(
      /\$\{\{[^}\n]*\b(?:secrets\s*(?:\.|\[)|github\s*(?:\.\s*token\b|\[))[^}\n]*\}\}/giu,
    ) ?? [];
  if (workflowName !== "release.yml") {
    if (references.length > 0) {
      policyFailure(`${workflowName} cannot contain a repository secret reference.`);
    }
    return;
  }
  const expected = [
    "${{ github.token }}",
    "${{ github.token }}",
    "${{ github.token }}",
    "${{ secrets.NPM_TOKEN }}",
  ].sort();
  if (JSON.stringify(references.sort()) !== JSON.stringify(expected)) {
    policyFailure(
      "release token references must remain bound to reviewed release steps and GitHub API fields.",
    );
  }
}

function lineIndent(line) {
  return line.length - line.trimStart().length;
}

function mappingEntries(lines, startIndex, expectedIndent, label) {
  const entries = new Map();
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const indent = lineIndent(line);
    if (indent <= expectedIndent) {
      break;
    }
    if (indent !== expectedIndent + 2) {
      policyFailure(`${label} contains an unsupported nested entry on line ${index + 1}.`);
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.+)$/u.exec(trimmed);
    if (!match) {
      policyFailure(`${label} contains an invalid mapping entry on line ${index + 1}.`);
    }
    if (entries.has(match[1])) {
      policyFailure(`${label} repeats ${match[1]}.`);
    }
    entries.set(match[1], match[2].trim());
  }
  return entries;
}

function directBlockKeys(lines, startIndex, label) {
  const keys = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }
    const indent = lineIndent(line);
    if (indent === 0) {
      break;
    }
    if (indent !== 2) {
      continue;
    }
    const match = /^ {2}([A-Za-z0-9_-]+):(?:\s.*)?$/u.exec(line);
    if (!match) {
      policyFailure(`${label} contains an unsupported key on line ${index + 1}.`);
    }
    if (keys.includes(match[1])) {
      policyFailure(`${label} repeats ${match[1]}.`);
    }
    keys.push(match[1]);
  }
  return keys.sort();
}

function exactBlockLines(lines, startIndex) {
  const block = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() !== "" && lineIndent(line) === 0) {
      break;
    }
    if (line.trim() !== "" && !line.trimStart().startsWith("#")) {
      block.push(line);
    }
  }
  return block;
}

function directMappingKeys(lines, startIndex, parentIndent, label) {
  const keys = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }
    const indent = lineIndent(line);
    if (indent <= parentIndent) {
      break;
    }
    if (indent !== parentIndent + 2) {
      continue;
    }
    const match = /^[ ]*([A-Za-z0-9_-]+):(?:\s.*)?$/u.exec(line);
    if (!match || keys.includes(match[1])) {
      policyFailure(`${label} contains an invalid or duplicate key on line ${index + 1}.`);
    }
    keys.push(match[1]);
  }
  return keys.sort();
}

function validateExactJobKeys(job, expectedKeys, workflowName) {
  const actualKeys = directMappingKeys(job.lines, 0, 2, `${workflowName} job ${job.name}`);
  if (JSON.stringify(actualKeys) !== JSON.stringify([...expectedKeys].sort())) {
    policyFailure(`${workflowName} job ${job.name} must retain its exact reviewed keys.`);
  }
}

function validateExactNestedKeys(job, parentKey, parentIndent, expectedKeys, workflowName) {
  const indexes = job.lines
    .map((line, index) =>
      lineIndent(line) === parentIndent && line.trim() === `${parentKey}:` ? index : -1,
    )
    .filter((index) => index >= 0);
  if (indexes.length !== 1) {
    policyFailure(`${workflowName} job ${job.name} must define ${parentKey} exactly once.`);
  }
  const actualKeys = directMappingKeys(
    job.lines,
    indexes[0],
    parentIndent,
    `${workflowName} job ${job.name} ${parentKey}`,
  );
  if (JSON.stringify(actualKeys) !== JSON.stringify([...expectedKeys].sort())) {
    policyFailure(`${workflowName} job ${job.name} ${parentKey} keys are not reviewed.`);
  }
}

function requireTopLevelKey(lines, key, workflowName) {
  const indexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === `${key}:` || lines[index].startsWith(`${key}: `)) {
      indexes.push(index);
    }
  }
  if (indexes.length !== 1) {
    policyFailure(`${workflowName} must define top-level ${key} exactly once.`);
  }
  return indexes[0];
}

function parseJobs(lines, workflowName) {
  const jobsIndex = requireTopLevelKey(lines, "jobs", workflowName);
  const jobs = [];
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(line);
    if (!match) {
      if (lineIndent(line) === 2 && line.trim() !== "" && !line.trim().startsWith("#")) {
        policyFailure(
          `${workflowName} contains an unsupported job declaration on line ${index + 1}.`,
        );
      }
      continue;
    }
    const start = index;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^ {2}[A-Za-z0-9_-]+:\s*$/u.test(lines[cursor])) {
        end = cursor;
        break;
      }
    }
    jobs.push({ name: match[1], start, end, lines: lines.slice(start, end) });
    index = end - 1;
  }
  if (jobs.length === 0) {
    policyFailure(`${workflowName} must define at least one job.`);
  }
  const uniqueNames = new Set(jobs.map((job) => job.name));
  if (uniqueNames.size !== jobs.length) {
    policyFailure(`${workflowName} repeats a job identifier.`);
  }
  return jobs;
}

function validatePermissions(lines, workflowName) {
  const topLevelIndex = requireTopLevelKey(lines, "permissions", workflowName);
  const topLevel = mappingEntries(lines, topLevelIndex, 0, `${workflowName} top-level permissions`);
  if (topLevel.size !== 1 || topLevel.get("contents") !== "read") {
    policyFailure(`${workflowName} top-level permissions must be exactly contents: read.`);
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== "permissions:") {
      continue;
    }
    const indent = lineIndent(lines[index]);
    if (indent !== 0 && indent !== 4) {
      policyFailure(`${workflowName} permissions must be top-level or job-scoped.`);
    }
    const entries = mappingEntries(lines, index, indent, `${workflowName} permissions`);
    for (const [name, value] of entries) {
      const reviewedWrite =
        name === "security-events" || (workflowName === "release.yml" && name === "id-token");
      if (value === "write" && !reviewedWrite) {
        policyFailure(`${workflowName} cannot grant ${name}: write.`);
      }
      if (value !== "read" && value !== "write" && value !== "none") {
        policyFailure(`${workflowName} has an invalid ${name} permission value.`);
      }
    }
    if (indent === 4 && entries.get("contents") !== "read") {
      policyFailure(`${workflowName} job permissions must retain contents: read.`);
    }
  }
}

function validateConcurrency(lines, workflowName) {
  const concurrencyIndex = requireTopLevelKey(lines, "concurrency", workflowName);
  const concurrency = mappingEntries(lines, concurrencyIndex, 0, `${workflowName} concurrency`);
  const releaseWorkflow = workflowName === "release.yml";
  const expectedGroup = releaseWorkflow
    ? "${{ github.workflow }}"
    : "${{ github.workflow }}-${{ github.ref }}";
  const expectedCancellation = releaseWorkflow ? "false" : "true";
  if (
    concurrency.size !== 2 ||
    concurrency.get("group") !== expectedGroup ||
    concurrency.get("cancel-in-progress") !== expectedCancellation
  ) {
    policyFailure(
      releaseWorkflow
        ? "release concurrency must serialize all package dist-tag transitions without cancellation."
        : `${workflowName} concurrency must bind github.workflow/ref and cancel duplicates.`,
    );
  }
}

function validateJobBounds(jobs, workflowName) {
  for (const job of jobs) {
    const timeoutLines = job.lines.filter((line) => /^ {4}timeout-minutes:\s*/u.test(line));
    if (timeoutLines.length !== 1) {
      policyFailure(`${workflowName} job ${job.name} must define timeout-minutes exactly once.`);
    }
    const timeout = Number(timeoutLines[0].split(":", 2)[1].trim());
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_JOB_TIMEOUT_MINUTES) {
      policyFailure(
        `${workflowName} job ${job.name} timeout-minutes must be within 1..${MAX_JOB_TIMEOUT_MINUTES}.`,
      );
    }
    const runners = job.lines
      .map((line) => /^ {4}runs-on:\s*(.+)$/u.exec(line)?.[1]?.trim())
      .filter(Boolean);
    if (runners.length !== 1 || runners[0] !== "ubuntu-24.04") {
      policyFailure(`${workflowName} job ${job.name} must run on pinned ubuntu-24.04.`);
    }
  }
}

function validateActions(lines, workflowName) {
  const actions = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*-\s+uses\s*:/u.test(lines[index])) {
      continue;
    }
    const match =
      /^\s*-\s+uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)@([^\s#]+)\s+#\s+(v\d+\.\d+\.\d+)\s*$/u.exec(
        lines[index],
      );
    if (!match) {
      policyFailure(
        `${workflowName} action on line ${index + 1} must use an immutable 40-character SHA and reviewed version comment.`,
      );
    }
    const actionPath = match[1];
    const revision = match[2];
    const owner = actionPath.split("/", 1)[0];
    if (!ALLOWED_ACTION_OWNERS.has(owner)) {
      policyFailure(`${workflowName} action owner ${owner} is not allowed.`);
    }
    if (!/^[0-9a-f]{40}$/u.test(revision)) {
      policyFailure(`${workflowName} action ${actionPath} must use an immutable 40-character SHA.`);
    }
    const reviewed = REVIEWED_ACTION_REVISIONS.get(actionPath);
    if (reviewed?.revision !== revision || reviewed.version !== match[3]) {
      policyFailure(`${workflowName} action ${actionPath} does not use a reviewed revision.`);
    }
    actions.push({ actionPath, revision, version: match[3], line: index });
  }

  for (const action of actions.filter(({ actionPath }) => actionPath === "actions/checkout")) {
    const actionIndent = lineIndent(lines[action.line]);
    let end = lines.length;
    for (let index = action.line + 1; index < lines.length; index += 1) {
      if (
        lineIndent(lines[index]) === actionIndent &&
        /^\s*-\s+(?:uses|run):/u.test(lines[index])
      ) {
        end = index;
        break;
      }
    }
    const credentialSettings = lines
      .slice(action.line + 1, end)
      .map((line) => /^\s*persist-credentials:\s*(.+)$/u.exec(line)?.[1]?.trim())
      .filter(Boolean);
    if (credentialSettings.length !== 1 || credentialSettings[0] !== "false") {
      policyFailure(`${workflowName} checkout steps must set persist-credentials: false.`);
    }
  }

  return actions;
}

function validateActionInputs(
  lines,
  actions,
  actionPath,
  expectedEntries,
  workflowName,
  expectedCount = 1,
) {
  const matchingActions = actions.filter((action) => action.actionPath === actionPath);
  const expectedSequence = Array.isArray(expectedEntries)
    ? expectedEntries
    : Array.from({ length: expectedCount }, () => expectedEntries);
  if (matchingActions.length !== expectedSequence.length) {
    policyFailure(
      `${workflowName} must invoke ${actionPath} exactly ${expectedSequence.length} time(s).`,
    );
  }
  for (const [actionIndex, action] of matchingActions.entries()) {
    const expected = new Map(Object.entries(expectedSequence[actionIndex]));
    let end = lines.length;
    for (let index = action.line + 1; index < lines.length; index += 1) {
      if (
        /^\s*-\s+(?:uses|run|name)\s*:/u.test(lines[index]) ||
        /^ {2}[A-Za-z0-9_-]+:\s*$/u.test(lines[index])
      ) {
        end = index;
        break;
      }
    }
    const withIndexes = lines
      .slice(action.line + 1, end)
      .map((line, index) => (line.trim() === "with:" ? action.line + 1 + index : -1))
      .filter((index) => index >= 0);
    const directStepKeys = lines
      .slice(action.line + 1, end)
      .filter(
        (line) =>
          line.trim() !== "" &&
          !line.trimStart().startsWith("#") &&
          lineIndent(line) === lineIndent(lines[action.line]) + 2,
      )
      .map((line) => /^\s*([A-Za-z0-9_-]+):(?:\s.*)?$/u.exec(line)?.[1])
      .filter(Boolean)
      .sort();
    const expectedStepKeys = expected.size === 0 ? [] : ["with"];
    if (JSON.stringify(directStepKeys) !== JSON.stringify(expectedStepKeys)) {
      policyFailure(`${workflowName} ${actionPath} action step keys are not reviewed.`);
    }
    if (expected.size === 0) {
      if (withIndexes.length !== 0) {
        policyFailure(`${workflowName} ${actionPath} cannot add unreviewed inputs.`);
      }
      continue;
    }
    if (
      withIndexes.length !== 1 ||
      lineIndent(lines[withIndexes[0]]) !== lineIndent(lines[action.line]) + 2
    ) {
      policyFailure(`${workflowName} ${actionPath} must define one reviewed input block.`);
    }
    const inputs = mappingEntries(
      lines,
      withIndexes[0],
      lineIndent(lines[withIndexes[0]]),
      `${workflowName} ${actionPath} inputs`,
    );
    if (
      inputs.size !== expected.size ||
      [...expected].some(([key, value]) => inputs.get(key) !== value)
    ) {
      policyFailure(`${workflowName} ${actionPath} inputs must match the reviewed configuration.`);
    }
  }
}

function extractRunCommands(job) {
  return job.lines.map((line) => /^\s*-\s+run:\s+(.+)$/u.exec(line)?.[1]?.trim()).filter(Boolean);
}

function extractStepIdentities(job, workflowName) {
  const steps = [];
  for (const line of job.lines) {
    if (!/^ {6}-\s+/u.test(line)) continue;
    const action = /^ {6}- uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)@/u.exec(
      line,
    );
    if (action) {
      steps.push(`uses:${action[1]}`);
      continue;
    }
    const command = /^ {6}- run:\s+(.+)$/u.exec(line);
    if (command) {
      steps.push(`run:${command[1].trim()}`);
      continue;
    }
    policyFailure(`${workflowName} job ${job.name} contains an unreviewed step declaration.`);
  }
  return steps;
}

function validateCiWorkflow(lines, jobs, actions) {
  if (jobs.length !== 1 || jobs[0].name !== "quality") {
    policyFailure("ci.yml must contain only the quality job.");
  }
  validateExactJobKeys(jobs[0], ["runs-on", "timeout-minutes", "strategy", "steps"], "ci.yml");
  validateExactNestedKeys(jobs[0], "strategy", 4, ["fail-fast", "matrix"], "ci.yml");
  validateExactNestedKeys(jobs[0], "matrix", 6, ["node"], "ci.yml");
  const onIndex = requireTopLevelKey(lines, "on", "ci.yml");
  const triggers = directBlockKeys(lines, onIndex, "ci.yml on");
  if (JSON.stringify(triggers) !== JSON.stringify(["pull_request", "push"])) {
    policyFailure("ci.yml triggers must be exactly pull_request and push.");
  }
  if (
    JSON.stringify(exactBlockLines(lines, onIndex)) !==
    JSON.stringify(["  push:", "  pull_request:"])
  ) {
    policyFailure("ci.yml trigger blocks cannot add branch, path, type or event filters.");
  }
  if (lines.filter((line) => line === '        node: ["22.13.0", "24"]').length !== 1) {
    policyFailure("ci.yml must retain the exact Node matrix 22.13.0 and 24.");
  }
  if (lines.filter((line) => line === "      fail-fast: false").length !== 1) {
    policyFailure("ci.yml must keep fail-fast disabled for complete matrix evidence.");
  }
  if (lines.filter((line) => line.trim() === "permissions:").length !== 1) {
    policyFailure("ci.yml jobs cannot add write-capable permission blocks.");
  }
  if (lines.some((line) => line.trim().startsWith("if:"))) {
    policyFailure("ci.yml cannot conditionally skip its quality job or gate steps.");
  }
  if (lines.some((line) => line.trim() === "env:")) {
    policyFailure("ci.yml cannot inject workflow, job or step environment values.");
  }
  const commands = extractRunCommands(jobs[0]);
  if (JSON.stringify(commands) !== JSON.stringify(CI_RELEASE_GATES)) {
    policyFailure("ci.yml must preserve the complete ordered release gate command chain.");
  }
  if (
    JSON.stringify(actions.map(({ actionPath }) => actionPath)) !==
    JSON.stringify(["actions/checkout", "actions/setup-node", "actions/setup-node"])
  ) {
    policyFailure("ci.yml must preserve the exact reviewed action chain.");
  }
  validateActionInputs(
    lines,
    actions,
    "actions/checkout",
    { "fetch-depth": "2", "persist-credentials": "false" },
    "ci.yml",
  );
  validateActionInputs(
    lines,
    actions,
    "actions/setup-node",
    [{ "node-version": '"24"' }, { "node-version": "${{ matrix.node }}" }],
    "ci.yml",
  );
  const expectedSteps = [
    "uses:actions/checkout",
    "uses:actions/setup-node",
    ...CI_RELEASE_GATES.slice(0, 3).map((command) => `run:${command}`),
    "uses:actions/setup-node",
    ...CI_RELEASE_GATES.slice(3).map((command) => `run:${command}`),
  ];
  if (JSON.stringify(extractStepIdentities(jobs[0], "ci.yml")) !== JSON.stringify(expectedSteps)) {
    policyFailure("ci.yml must preserve the exact interleaved action and command step chain.");
  }
}

function validateSecurityWorkflow(lines, jobs, actions) {
  const onIndex = requireTopLevelKey(lines, "on", "security.yml");
  const triggers = directBlockKeys(lines, onIndex, "security.yml on");
  if (
    JSON.stringify(triggers) !==
    JSON.stringify(["pull_request", "push", "schedule", "workflow_dispatch"])
  ) {
    policyFailure("security.yml must use exactly the reviewed trigger set.");
  }
  if (
    JSON.stringify(exactBlockLines(lines, onIndex)) !==
    JSON.stringify([
      "  push:",
      "    branches: [main]",
      "  pull_request:",
      "    branches: [main]",
      "  schedule:",
      '    - cron: "17 6 * * 1"',
      "  workflow_dispatch:",
    ])
  ) {
    policyFailure("security.yml trigger blocks must match the reviewed branches and schedule.");
  }
  const expectedJobs = ["audit", "codeql", "dependency-review"];
  const actualJobs = jobs.map((job) => job.name).sort();
  if (JSON.stringify(actualJobs) !== JSON.stringify(expectedJobs)) {
    policyFailure("security.yml must contain audit, dependency-review and codeql jobs.");
  }
  const auditJob = jobs.find(({ name }) => name === "audit");
  const dependencyReviewJob = jobs.find(({ name }) => name === "dependency-review");
  const codeqlJob = jobs.find(({ name }) => name === "codeql");
  validateExactJobKeys(auditJob, ["runs-on", "timeout-minutes", "steps"], "security.yml");
  validateExactJobKeys(
    dependencyReviewJob,
    ["if", "runs-on", "timeout-minutes", "steps"],
    "security.yml",
  );
  validateExactJobKeys(
    codeqlJob,
    ["permissions", "runs-on", "timeout-minutes", "strategy", "steps"],
    "security.yml",
  );
  validateExactNestedKeys(codeqlJob, "strategy", 4, ["fail-fast", "matrix"], "security.yml");
  validateExactNestedKeys(codeqlJob, "matrix", 6, ["language"], "security.yml");
  const conditionLines = lines.filter((line) => line.trim().startsWith("if:"));
  if (
    conditionLines.length !== 1 ||
    conditionLines[0] !== "    if: github.event_name == 'pull_request'"
  ) {
    policyFailure("security.yml must condition only dependency review on pull requests.");
  }
  if (lines.some((line) => line.trim() === "env:")) {
    policyFailure("security.yml cannot inject workflow, job or step environment values.");
  }
  if (
    lines.filter((line) => line === '        language: ["javascript-typescript"]').length !== 1 ||
    lines.filter((line) => line === "      fail-fast: false").length !== 1 ||
    lines.filter((line) => line === '    - cron: "17 6 * * 1"').length !== 1 ||
    lines.filter((line) => line === "    branches: [main]").length !== 2
  ) {
    policyFailure("security.yml must preserve the reviewed branches, schedule and CodeQL matrix.");
  }
  const actionPaths = actions.map(({ actionPath }) => actionPath);
  for (const actionPath of [
    "actions/dependency-review-action",
    "github/codeql-action/init",
    "github/codeql-action/analyze",
  ]) {
    if (!actionPaths.includes(actionPath)) {
      policyFailure(`security.yml must invoke ${actionPath}.`);
    }
  }
  const codeqlPermissionsIndex = codeqlJob.lines.findIndex(
    (line) => line.trim() === "permissions:",
  );
  if (codeqlPermissionsIndex < 0) {
    policyFailure("security.yml codeql job must declare least permissions.");
  }
  const codeqlPermissions = mappingEntries(
    codeqlJob.lines,
    codeqlPermissionsIndex,
    4,
    "security.yml codeql permissions",
  );
  if (
    codeqlPermissions.size !== 2 ||
    codeqlPermissions.get("contents") !== "read" ||
    codeqlPermissions.get("security-events") !== "write"
  ) {
    policyFailure(
      "security.yml codeql permissions must be contents: read and security-events: write.",
    );
  }
  if (
    JSON.stringify(extractRunCommands(auditJob)) !==
    JSON.stringify(["corepack enable", "yarn install --immutable", "yarn audit"])
  ) {
    policyFailure("security.yml audit job must run the immutable dependency audit chain.");
  }
  const jobActionPaths = (job) =>
    actions
      .filter(({ line }) => line >= job.start && line < job.end)
      .map(({ actionPath }) => actionPath);
  const expectedJobActions = new Map([
    ["audit", ["actions/checkout", "actions/setup-node"]],
    ["dependency-review", ["actions/checkout", "actions/dependency-review-action"]],
    ["codeql", ["actions/checkout", "github/codeql-action/init", "github/codeql-action/analyze"]],
  ]);
  for (const job of jobs) {
    if (JSON.stringify(jobActionPaths(job)) !== JSON.stringify(expectedJobActions.get(job.name))) {
      policyFailure(`security.yml job ${job.name} must preserve its exact reviewed action chain.`);
    }
    if (job.name !== "audit" && extractRunCommands(job).length !== 0) {
      policyFailure(`security.yml job ${job.name} cannot add shell commands.`);
    }
  }
  validateActionInputs(
    lines,
    actions,
    "actions/checkout",
    { "persist-credentials": "false" },
    "security.yml",
    3,
  );
  validateActionInputs(
    lines,
    actions,
    "actions/setup-node",
    { "node-version": '"24"' },
    "security.yml",
  );
  validateActionInputs(lines, actions, "actions/dependency-review-action", {}, "security.yml");
  validateActionInputs(
    lines,
    actions,
    "github/codeql-action/init",
    { languages: "${{ matrix.language }}", "build-mode": "none" },
    "security.yml",
  );
  validateActionInputs(
    lines,
    actions,
    "github/codeql-action/analyze",
    { category: '"/language:${{ matrix.language }}"' },
    "security.yml",
  );
}

function validateJobEnvironment(job, expectedEntries) {
  const indexes = job.lines
    .map((line, index) => (line === "    env:" ? index : -1))
    .filter((index) => index >= 0);
  if (indexes.length !== 1) {
    policyFailure(`release.yml job ${job.name} must define one reviewed environment block.`);
  }
  const actual = mappingEntries(
    job.lines,
    indexes[0],
    4,
    `release.yml job ${job.name} environment`,
  );
  const expected = new Map(Object.entries(expectedEntries));
  if (
    actual.size !== expected.size ||
    [...expected].some(([key, value]) => actual.get(key) !== value)
  ) {
    policyFailure(`release.yml job ${job.name} environment must match the reviewed values.`);
  }
}

function validateRunStepEnvironments(job, expectedEntriesByCommand) {
  const environmentIndexes = job.lines
    .map((line, index) => (line === "        env:" ? index : -1))
    .filter((index) => index >= 0);
  if (environmentIndexes.length !== expectedEntriesByCommand.size) {
    policyFailure(`release.yml job ${job.name} must preserve exact step credential isolation.`);
  }
  for (const [command, expectedEntries] of expectedEntriesByCommand) {
    const runLine = `      - run: ${command}`;
    const runIndexes = job.lines
      .map((line, index) => (line === runLine ? index : -1))
      .filter((index) => index >= 0);
    if (runIndexes.length !== 1 || job.lines[runIndexes[0] + 1] !== "        env:") {
      policyFailure(`release.yml command ${command} must define one reviewed step environment.`);
    }
    const actual = mappingEntries(
      job.lines,
      runIndexes[0] + 1,
      8,
      `release.yml command ${command} environment`,
    );
    const expected = new Map(Object.entries(expectedEntries));
    if (
      actual.size !== expected.size ||
      [...expected].some(([key, value]) => actual.get(key) !== value)
    ) {
      policyFailure(`release.yml command ${command} environment must match the reviewed values.`);
    }
  }
}

function validateReleaseJobActions(job, expectedPaths, expectedInputs) {
  const actions = validateActions(job.lines, `release.yml job ${job.name}`);
  if (
    JSON.stringify(actions.map(({ actionPath }) => actionPath)) !== JSON.stringify(expectedPaths)
  ) {
    policyFailure(`release.yml job ${job.name} must preserve its exact reviewed action chain.`);
  }
  for (const [actionPath, inputs] of expectedInputs) {
    validateActionInputs(job.lines, actions, actionPath, inputs, "release.yml");
  }
}

function validateReleaseWorkflow(lines, jobs) {
  if (lines.filter((line) => line === "name: Release").length !== 1) {
    policyFailure("release.yml name must be exactly Release.");
  }
  const onIndex = requireTopLevelKey(lines, "on", "release.yml");
  if (
    JSON.stringify(directBlockKeys(lines, onIndex, "release.yml on")) !==
    JSON.stringify(["workflow_dispatch"])
  ) {
    policyFailure("release trigger block must contain only workflow_dispatch.");
  }
  const expectedTrigger = [
    "  workflow_dispatch:",
    "    inputs:",
    "      mode:",
    '        description: "Release mode: publish-next, verify-next, or promote-latest"',
    "        required: true",
    "        type: string",
    "      sha:",
    '        description: "Exact lowercase 40-character commit SHA on main"',
    "        required: true",
    "        type: string",
    "      version:",
    '        description: "Exact stable package version without a v prefix"',
    "        required: true",
    "        type: string",
    "      verification_run_id:",
    '        description: "Successful verify-next workflow run ID (promote-latest only)"',
    "        required: false",
    "        type: string",
    '        default: ""',
  ];
  if (JSON.stringify(exactBlockLines(lines, onIndex)) !== JSON.stringify(expectedTrigger)) {
    policyFailure(
      "release trigger block and inputs must match the exact reviewed dispatch contract.",
    );
  }

  const expectedJobs = [
    "prepare-publish",
    "promote-latest",
    "publish-next",
    "validate-dispatch",
    "verify-next",
  ];
  if (JSON.stringify(jobs.map(({ name }) => name).sort()) !== JSON.stringify(expectedJobs)) {
    policyFailure("release job inventory must contain only validation and the three exact modes.");
  }
  const byName = new Map(jobs.map((job) => [job.name, job]));
  const validation = byName.get("validate-dispatch");
  const preparation = byName.get("prepare-publish");
  const publish = byName.get("publish-next");
  const verify = byName.get("verify-next");
  const promote = byName.get("promote-latest");
  if (
    lines.filter((line) => line === "    environment: npm-publish").length !== 1 ||
    !publish.lines.includes("    environment: npm-publish") ||
    lines.filter((line) => line === "    environment: production").length !== 1 ||
    !promote.lines.includes("    environment: production")
  ) {
    policyFailure(
      "release publication and promotion must bind only to their reviewed protected Environments.",
    );
  }
  validateExactJobKeys(validation, ["runs-on", "timeout-minutes", "env", "steps"], "release.yml");
  validateExactJobKeys(
    preparation,
    ["needs", "if", "permissions", "runs-on", "timeout-minutes", "env", "steps"],
    "release.yml",
  );
  validateExactJobKeys(
    publish,
    ["needs", "if", "permissions", "environment", "runs-on", "timeout-minutes", "env", "steps"],
    "release.yml",
  );
  validateExactJobKeys(
    verify,
    ["needs", "if", "runs-on", "timeout-minutes", "env", "steps"],
    "release.yml",
  );
  validateExactJobKeys(
    promote,
    ["needs", "if", "permissions", "environment", "runs-on", "timeout-minutes", "env", "steps"],
    "release.yml",
  );

  const conditions = lines.filter((line) => line.startsWith("    if:"));
  if (
    JSON.stringify(conditions) !==
    JSON.stringify([
      "    if: inputs.mode == 'publish-next'",
      "    if: inputs.mode == 'publish-next'",
      "    if: inputs.mode == 'verify-next'",
      "    if: inputs.mode == 'promote-latest'",
    ])
  ) {
    policyFailure(
      "release publish-next, verify-next condition, and promote-latest conditions must be exact.",
    );
  }
  if (
    lines.filter((line) => line === "    needs: validate-dispatch").length !== 3 ||
    !publish.lines.includes("    needs: prepare-publish")
  ) {
    policyFailure("release mode jobs must preserve the reviewed validation/preparation chain.");
  }

  validateExactNestedKeys(preparation, "permissions", 4, ["contents", "actions"], "release.yml");
  validateExactNestedKeys(
    publish,
    "permissions",
    4,
    ["contents", "actions", "id-token"],
    "release.yml",
  );
  validateExactNestedKeys(promote, "permissions", 4, ["contents", "actions"], "release.yml");
  const publishPermissions = mappingEntries(
    publish.lines,
    publish.lines.indexOf("    permissions:"),
    4,
    "release.yml publish-next permissions",
  );
  if (
    publishPermissions.get("contents") !== "read" ||
    publishPermissions.get("actions") !== "read" ||
    publishPermissions.get("id-token") !== "write"
  ) {
    policyFailure(
      "release publish-next permissions must bind only contents/actions read and OIDC.",
    );
  }
  const preparationPermissions = mappingEntries(
    preparation.lines,
    preparation.lines.indexOf("    permissions:"),
    4,
    "release.yml prepare-publish permissions",
  );
  if (
    preparationPermissions.get("contents") !== "read" ||
    preparationPermissions.get("actions") !== "read"
  ) {
    policyFailure("release prepare-publish permissions must bind only contents/actions read.");
  }
  const promotePermissions = mappingEntries(
    promote.lines,
    promote.lines.indexOf("    permissions:"),
    4,
    "release.yml promote-latest permissions",
  );
  if (
    promotePermissions.get("contents") !== "read" ||
    promotePermissions.get("actions") !== "read"
  ) {
    policyFailure("release promote-latest permissions must bind only contents/actions read.");
  }

  const commonEnvironment = {
    RELEASE_MODE: "${{ inputs.mode }}",
    RELEASE_SHA: "${{ inputs.sha }}",
    RELEASE_VERSION: "${{ inputs.version }}",
    VERIFICATION_RUN_ID: "${{ inputs.verification_run_id }}",
  };
  const evidenceRoot = "/tmp/ast-mcp-release-${{ inputs.sha }}-${{ inputs.version }}";
  validateJobEnvironment(validation, commonEnvironment);
  validateJobEnvironment(preparation, {
    ...commonEnvironment,
    RELEASE_ENVIRONMENT: "npm-publish",
  });
  validateJobEnvironment(publish, {
    ...commonEnvironment,
    RELEASE_ENVIRONMENT: "npm-publish",
  });
  validateJobEnvironment(verify, {
    ...commonEnvironment,
    RELEASE_EVIDENCE_ROOT: evidenceRoot,
  });
  validateJobEnvironment(promote, {
    ...commonEnvironment,
    RELEASE_EVIDENCE_ROOT: evidenceRoot,
    RELEASE_ENVIRONMENT: "production",
  });
  validateRunStepEnvironments(validation, new Map());
  validateRunStepEnvironments(
    preparation,
    new Map([
      [
        "node scripts/release-preflight.mjs authorize-publish",
        { GITHUB_TOKEN: "${{ github.token }}" },
      ],
    ]),
  );
  validateRunStepEnvironments(publish, new Map());
  validateRunStepEnvironments(verify, new Map());
  validateRunStepEnvironments(
    promote,
    new Map([
      [
        "node scripts/release-preflight.mjs validate-promotion",
        { GITHUB_TOKEN: "${{ github.token }}" },
      ],
      [
        "node scripts/release-preflight.mjs promote-latest",
        { NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}" },
      ],
    ]),
  );

  const checkoutInputs = {
    ref: "${{ github.sha }}",
    "persist-credentials": "false",
  };
  const setupInputs = {
    "node-version": "24.16.0",
    "package-manager-cache": "false",
  };
  const registrySetupInputs = {
    ...setupInputs,
    "registry-url": "https://registry.npmjs.org",
  };
  validateReleaseJobActions(
    validation,
    ["actions/checkout", "actions/setup-node"],
    [
      ["actions/checkout", checkoutInputs],
      ["actions/setup-node", setupInputs],
    ],
  );
  validateReleaseJobActions(
    preparation,
    ["actions/checkout", "actions/setup-node", "actions/upload-artifact"],
    [
      ["actions/checkout", checkoutInputs],
      ["actions/setup-node", registrySetupInputs],
      [
        "actions/upload-artifact",
        {
          name: "ast-mcp-publish-${{ inputs.sha }}-${{ inputs.version }}",
          path: "/tmp/ast-mcp-publish-${{ inputs.sha }}-${{ inputs.version }}",
          "if-no-files-found": "error",
          "retention-days": "1",
          "compression-level": "0",
          overwrite: "false",
          "include-hidden-files": "false",
        },
      ],
    ],
  );
  validateReleaseJobActions(
    publish,
    ["actions/checkout", "actions/setup-node", "actions/download-artifact"],
    [
      ["actions/checkout", checkoutInputs],
      ["actions/setup-node", registrySetupInputs],
      [
        "actions/download-artifact",
        {
          name: "ast-mcp-publish-${{ inputs.sha }}-${{ inputs.version }}",
          path: "/tmp/ast-mcp-publish-${{ inputs.sha }}-${{ inputs.version }}",
        },
      ],
    ],
  );
  validateReleaseJobActions(
    verify,
    ["actions/checkout", "actions/setup-node", "actions/upload-artifact"],
    [
      ["actions/checkout", checkoutInputs],
      ["actions/setup-node", registrySetupInputs],
      [
        "actions/upload-artifact",
        {
          name: "ast-mcp-release-${{ inputs.sha }}-${{ inputs.version }}",
          path: "${{ env.RELEASE_EVIDENCE_ROOT }}",
          "if-no-files-found": "error",
          "retention-days": "30",
          "compression-level": "0",
          overwrite: "false",
          "include-hidden-files": "false",
        },
      ],
    ],
  );
  validateReleaseJobActions(
    promote,
    ["actions/checkout", "actions/setup-node", "actions/download-artifact"],
    [
      ["actions/checkout", checkoutInputs],
      ["actions/setup-node", registrySetupInputs],
      [
        "actions/download-artifact",
        {
          name: "ast-mcp-release-${{ inputs.sha }}-${{ inputs.version }}",
          path: "${{ env.RELEASE_EVIDENCE_ROOT }}",
          "github-token": "${{ github.token }}",
          repository: "${{ github.repository }}",
          "run-id": "${{ inputs.verification_run_id }}",
        },
      ],
    ],
  );

  const expectedCommands = new Map([
    [
      "validate-dispatch",
      [
        'test "$GITHUB_REF" = refs/heads/main && test "$RELEASE_SHA" = "$GITHUB_SHA"',
        "node scripts/release-preflight.mjs validate-dispatch",
      ],
    ],
    [
      "prepare-publish",
      [
        "node scripts/release-preflight.mjs validate-environment",
        "node scripts/release-preflight.mjs authorize-publish",
        'env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" corepack enable',
        'env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" yarn install --immutable --mode=skip-build',
        "node scripts/release-preflight.mjs prepare-publish",
      ],
    ],
    [
      "publish-next",
      [
        "env -u ACTIONS_ID_TOKEN_REQUEST_TOKEN -u ACTIONS_ID_TOKEN_REQUEST_URL node scripts/release-preflight.mjs validate-environment",
        "node scripts/release-preflight.mjs publish-next",
      ],
    ],
    [
      "verify-next",
      [
        "node scripts/release-preflight.mjs validate-environment",
        "node scripts/ci-prepare-gnu-mv.mjs prepare",
        'env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" corepack enable',
        'env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" yarn install --immutable --mode=skip-build',
        'node scripts/registry-consumer-smoke.mjs --version "$RELEASE_VERSION" --expected-sha "$RELEASE_SHA" --registry https://registry.npmjs.org --metadata-output "$RELEASE_EVIDENCE_ROOT/registry-metadata.json" --audit-output "$RELEASE_EVIDENCE_ROOT/npm-audit-signatures.json" --output "$RELEASE_EVIDENCE_ROOT/registry-consumer.json"',
        "node scripts/release-preflight.mjs verify-next",
      ],
    ],
    [
      "promote-latest",
      [
        "node scripts/release-preflight.mjs validate-promotion",
        "node scripts/release-preflight.mjs promote-latest",
      ],
    ],
  ]);
  for (const job of jobs) {
    if (
      JSON.stringify(extractRunCommands(job)) !== JSON.stringify(expectedCommands.get(job.name))
    ) {
      policyFailure(`release ${job.name} command chain must remain exact and single-line.`);
    }
  }
  const expectedSteps = new Map([
    [
      "validate-dispatch",
      [
        'run:test "$GITHUB_REF" = refs/heads/main && test "$RELEASE_SHA" = "$GITHUB_SHA"',
        "uses:actions/checkout",
        "uses:actions/setup-node",
        "run:node scripts/release-preflight.mjs validate-dispatch",
      ],
    ],
    [
      "prepare-publish",
      [
        "uses:actions/checkout",
        "uses:actions/setup-node",
        "run:node scripts/release-preflight.mjs validate-environment",
        "run:node scripts/release-preflight.mjs authorize-publish",
        'run:env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" corepack enable',
        'run:env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" yarn install --immutable --mode=skip-build',
        "run:node scripts/release-preflight.mjs prepare-publish",
        "uses:actions/upload-artifact",
      ],
    ],
    [
      "publish-next",
      [
        "uses:actions/checkout",
        "uses:actions/setup-node",
        "run:env -u ACTIONS_ID_TOKEN_REQUEST_TOKEN -u ACTIONS_ID_TOKEN_REQUEST_URL node scripts/release-preflight.mjs validate-environment",
        "uses:actions/download-artifact",
        "run:node scripts/release-preflight.mjs publish-next",
      ],
    ],
    [
      "verify-next",
      [
        "uses:actions/checkout",
        "uses:actions/setup-node",
        "run:node scripts/release-preflight.mjs validate-environment",
        "run:node scripts/ci-prepare-gnu-mv.mjs prepare",
        'run:env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" corepack enable',
        'run:env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" yarn install --immutable --mode=skip-build',
        'run:node scripts/registry-consumer-smoke.mjs --version "$RELEASE_VERSION" --expected-sha "$RELEASE_SHA" --registry https://registry.npmjs.org --metadata-output "$RELEASE_EVIDENCE_ROOT/registry-metadata.json" --audit-output "$RELEASE_EVIDENCE_ROOT/npm-audit-signatures.json" --output "$RELEASE_EVIDENCE_ROOT/registry-consumer.json"',
        "run:node scripts/release-preflight.mjs verify-next",
        "uses:actions/upload-artifact",
      ],
    ],
    [
      "promote-latest",
      [
        "uses:actions/checkout",
        "uses:actions/setup-node",
        "uses:actions/download-artifact",
        "run:node scripts/release-preflight.mjs validate-promotion",
        "run:node scripts/release-preflight.mjs promote-latest",
      ],
    ],
  ]);
  for (const job of jobs) {
    if (
      JSON.stringify(extractStepIdentities(job, "release.yml")) !==
      JSON.stringify(expectedSteps.get(job.name))
    ) {
      policyFailure(`release ${job.name} step chain must remain exact and ordered.`);
    }
  }
}

function validateWorkflowDocument(workflowName, source) {
  if (typeof source !== "string" || source.length === 0) {
    policyFailure(`${workflowName} must be a non-empty UTF-8 document.`);
  }
  if (Buffer.byteLength(source, "utf8") > MAX_WORKFLOW_BYTES) {
    policyFailure(`${workflowName} exceeds the ${MAX_WORKFLOW_BYTES}-byte policy limit.`);
  }
  if (source.includes("\r") || source.includes("\t")) {
    policyFailure(`${workflowName} must use LF line endings and spaces for indentation.`);
  }
  if (/^---\s*$/mu.test(source)) {
    policyFailure(`${workflowName} cannot contain multiple-document YAML markers.`);
  }
  if (/[:]\s*(?:!\S+\s+)*[|>][0-9+-]*\s*(?:#.*)?$/mu.test(source)) {
    policyFailure(`${workflowName} cannot contain YAML block scalars.`);
  }
  if (
    /^\s*(?:<<:\s*\*|[A-Za-z0-9_-]+:\s*[&*!]|-\s*(?:\{|\?|[&*!]|["'])|\?\s+)/mu.test(source) ||
    /^\s*(?:-\s*)?[A-Za-z0-9_-]+:\s*!/mu.test(source) ||
    /^\s*["'][^"']+["']\s*:/mu.test(source) ||
    /^\s*[A-Za-z0-9_-]+\s+:/mu.test(source) ||
    /^\s+(?:uses|run)\s*:/mu.test(source) ||
    /^\s*(?:on|jobs|permissions|concurrency|steps|strategy|matrix|with|env):\s*[[{]/mu.test(source)
  ) {
    policyFailure(`${workflowName} uses unsupported YAML indirection or flow mappings.`);
  }
  if (/^\s*(?:pull_request_target|workflow_run):/mu.test(source)) {
    const trigger = source.match(/^\s*(pull_request_target|workflow_run):/mu)?.[1];
    policyFailure(`${workflowName} cannot use privileged trigger ${trigger}.`);
  }
  validateCredentialReferences(source, workflowName);
  if (/\b(?:read-all|write-all)\b/u.test(source)) {
    policyFailure(`${workflowName} cannot use broad permission shorthands.`);
  }
  if (
    /^\s*(?:continue-on-error|shell|working-directory|defaults|container|services|include|exclude):/mu.test(
      source,
    )
  ) {
    policyFailure(`${workflowName} contains a forbidden gate-bypass control.`);
  }

  const lines = source.endsWith("\n") ? source.slice(0, -1).split("\n") : source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*-\s+run:\s+\S/u.test(lines[index])) {
      continue;
    }
    const runIndent = lineIndent(lines[index]);
    const nestedLines = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].trim() === "" || lines[cursor].trimStart().startsWith("#")) {
        continue;
      }
      if (lineIndent(lines[cursor]) <= runIndent) {
        break;
      }
      nestedLines.push(lines[cursor]);
    }
    const reviewedReleaseStepEnvironment =
      workflowName === "release.yml" &&
      nestedLines.length >= 2 &&
      nestedLines[0] === `${" ".repeat(runIndent + 2)}env:` &&
      nestedLines
        .slice(1)
        .every(
          (line) =>
            lineIndent(line) === runIndent + 4 &&
            /^[A-Za-z_][A-Za-z0-9_]*:\s+\S(?:.*\S)?$/u.test(line.trim()),
        );
    if (nestedLines.length > 0 && !reviewedReleaseStepEnvironment) {
      policyFailure(`${workflowName} run steps must be single-line reviewed commands.`);
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*[A-Za-z0-9_-]+:\s+\S/u.test(lines[index])) {
      continue;
    }
    const scalarIndent = lineIndent(lines[index]);
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].trim() === "" || lines[cursor].trimStart().startsWith("#")) {
        continue;
      }
      if (lineIndent(lines[cursor]) > scalarIndent) {
        policyFailure(`${workflowName} scalar values cannot continue onto line ${cursor + 1}.`);
      }
      break;
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    if (!/^(?:-\s+)?[A-Za-z0-9_-]+:\s*.*$/u.test(trimmed)) {
      policyFailure(
        `${workflowName} contains an unsupported multiline scalar on line ${index + 1}.`,
      );
    }
  }
  const allowedTopLevelKeys = new Set(["name", "on", "permissions", "concurrency", "jobs"]);
  for (let index = 0; index < lines.length; index += 1) {
    if (
      lineIndent(lines[index]) !== 0 ||
      lines[index].trim() === "" ||
      lines[index].trim().startsWith("#")
    ) {
      continue;
    }
    const topLevelKey = /^([A-Za-z0-9_-]+):(?:\s.*)?$/u.exec(lines[index])?.[1];
    if (!topLevelKey || !allowedTopLevelKeys.has(topLevelKey)) {
      policyFailure(`${workflowName} contains an unsupported top-level key on line ${index + 1}.`);
    }
  }
  for (const key of ["name", "on", "permissions", "concurrency", "jobs"]) {
    requireTopLevelKey(lines, key, workflowName);
  }
  validatePermissions(lines, workflowName);
  validateConcurrency(lines, workflowName);
  const jobs = parseJobs(lines, workflowName);
  if (
    workflowName === "release.yml" &&
    JSON.stringify(jobs.map(({ name }) => name).sort()) !==
      JSON.stringify([
        "prepare-publish",
        "promote-latest",
        "publish-next",
        "validate-dispatch",
        "verify-next",
      ])
  ) {
    policyFailure("release job inventory must contain only validation and the three exact modes.");
  }
  validateJobBounds(jobs, workflowName);
  const actions = validateActions(lines, workflowName);

  if (workflowName === "ci.yml") {
    validateCiWorkflow(lines, jobs, actions);
  } else if (workflowName === "release.yml") {
    validateReleaseWorkflow(lines, jobs, actions);
  } else if (workflowName === "security.yml") {
    validateSecurityWorkflow(lines, jobs, actions);
  }
  return { jobCount: jobs.length, actionCount: actions.length };
}

export function validateWorkflowPolicyDocuments(documents) {
  if (documents === null || typeof documents !== "object" || Array.isArray(documents)) {
    policyFailure("workflow documents must be a filename-to-source object.");
  }
  const workflows = Object.keys(documents).sort();
  if (workflows.length === 0 || workflows.length > 16) {
    policyFailure("workflow inventory must contain between 1 and 16 documents.");
  }
  for (const requiredWorkflow of REQUIRED_WORKFLOWS) {
    if (!Object.hasOwn(documents, requiredWorkflow)) {
      policyFailure(`required workflow ${requiredWorkflow} is missing.`);
    }
  }
  if (JSON.stringify(workflows) !== JSON.stringify(REQUIRED_WORKFLOWS)) {
    policyFailure(`workflow inventory must be exactly ${REQUIRED_WORKFLOWS.join(", ")}.`);
  }

  let jobCount = 0;
  let actionCount = 0;
  for (const workflowName of workflows) {
    if (!/^[A-Za-z0-9_.-]+\.ya?ml$/u.test(workflowName)) {
      policyFailure(`invalid workflow filename ${workflowName}.`);
    }
    const result = validateWorkflowDocument(workflowName, documents[workflowName]);
    jobCount += result.jobCount;
    actionCount += result.actionCount;
  }
  return {
    status: "pass",
    workflow_count: workflows.length,
    job_count: jobCount,
    action_count: actionCount,
    workflows,
  };
}

export async function checkWorkflowPolicy(repositoryRoot = process.cwd()) {
  const workflowsRoot = path.join(path.resolve(repositoryRoot), ".github", "workflows");
  const entries = await readdir(workflowsRoot, { withFileTypes: true });
  const workflowEntries = entries
    .filter((entry) => entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (workflowEntries.some((entry) => !entry.isFile())) {
    policyFailure("workflow entries must be regular files.");
  }
  const documents = Object.fromEntries(
    await Promise.all(
      workflowEntries.map(async (entry) => [
        entry.name,
        await readFile(path.join(workflowsRoot, entry.name), "utf8"),
      ]),
    ),
  );
  return validateWorkflowPolicyDocuments(documents);
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.argv.length !== 2) {
    process.stderr.write("Usage: node scripts/workflow-policy-check.mjs\n");
    process.exitCode = 1;
  } else {
    try {
      const result = await checkWorkflowPolicy();
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workflow policy check failed.";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  }
}
