import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  checkWorkflowPolicy,
  validateWorkflowPolicyDocuments,
} from "../scripts/workflow-policy-check.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowsRoot = path.join(repositoryRoot, ".github", "workflows");

async function loadWorkflowDocuments(): Promise<Record<string, string>> {
  const names = (await readdir(workflowsRoot))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await readFile(path.join(workflowsRoot, name), "utf8")]),
    ),
  );
}

function replaceRequired(source: string, oldValue: string, newValue: string): string {
  expect(source).toContain(oldValue);
  return source.replace(oldValue, newValue);
}

describe("workflow policy check", () => {
  it("accepts the complete pinned Linux CI and security policy", async () => {
    const documents = await loadWorkflowDocuments();

    expect(validateWorkflowPolicyDocuments(documents)).toEqual({
      status: "pass",
      workflow_count: 2,
      job_count: 4,
      action_count: 9,
      workflows: ["ci.yml", "security.yml"],
    });
    await expect(checkWorkflowPolicy(repositoryRoot)).resolves.toEqual(
      validateWorkflowPolicyDocuments(documents),
    );

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [path.join(repositoryRoot, "scripts", "workflow-policy-check.mjs")],
      { cwd: repositoryRoot },
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(validateWorkflowPolicyDocuments(documents));
  });

  it("rejects floating or untrusted third-party action references", async () => {
    const documents = await loadWorkflowDocuments();
    const floating = {
      ...documents,
      "ci.yml": documents["ci.yml"].replace(
        /actions\/checkout@[0-9a-f]{40}/u,
        "actions/checkout@v7",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(floating)).toThrow(/immutable 40-character SHA/u);

    const untrusted = {
      ...documents,
      "ci.yml": documents["ci.yml"].replace("actions/checkout@", "untrusted/checkout@"),
    };
    expect(() => validateWorkflowPolicyDocuments(untrusted)).toThrow(/action owner/u);

    const unreviewed = {
      ...documents,
      "ci.yml": documents["ci.yml"].replace(
        "3d3c42e5aac5ba805825da76410c181273ba90b1",
        "a".repeat(40),
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(unreviewed)).toThrow(/reviewed revision/u);

    const unreviewedSubaction = {
      ...documents,
      "ci.yml": documents["ci.yml"].replace("actions/checkout@", "actions/checkout/run@"),
    };
    expect(() => validateWorkflowPolicyDocuments(unreviewedSubaction)).toThrow(
      /reviewed revision/u,
    );

    const ambiguousActionKey = {
      ...documents,
      "ci.yml": documents["ci.yml"].replace(
        "- uses: actions/checkout@",
        "- uses : actions/checkout@",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(ambiguousActionKey)).toThrow(
      /unsupported multiline scalar/u,
    );

    const extraReviewedAction = {
      ...documents,
      "security.yml": documents["security.yml"].replace(
        "      - uses: actions/dependency-review-action@",
        "      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n      - uses: actions/dependency-review-action@",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(extraReviewedAction)).toThrow(/action chain/u);
  });

  it("rejects broad permissions and missing job/runtime bounds", async () => {
    const documents = await loadWorkflowDocuments();
    const broadPermissions = {
      ...documents,
      "ci.yml": replaceRequired(documents["ci.yml"], "  contents: read", "  contents: write"),
    };
    expect(() => validateWorkflowPolicyDocuments(broadPermissions)).toThrow(/contents: read/u);

    const oidcWrite = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"],
        "  contents: read",
        "  contents: read\n  id-token: write",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(oidcWrite)).toThrow(/contents: read/u);

    for (const jobName of ["audit", "codeql"]) {
      const dependentSecurityJob = {
        ...documents,
        "security.yml": replaceRequired(
          documents["security.yml"],
          `  ${jobName}:\n`,
          `  ${jobName}:\n    needs: dependency-review\n`,
        ),
      };
      expect(() => validateWorkflowPolicyDocuments(dependentSecurityJob)).toThrow(
        /exact reviewed keys/u,
      );
    }

    const auditWritePermission = {
      ...documents,
      "security.yml": replaceRequired(
        documents["security.yml"],
        "  audit:\n",
        "  audit:\n    permissions:\n      contents: read\n      security-events: write\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(auditWritePermission)).toThrow(
      /exact reviewed keys/u,
    );

    const dependencyReviewReadPermission = {
      ...documents,
      "security.yml": replaceRequired(
        documents["security.yml"],
        "  dependency-review:\n",
        "  dependency-review:\n    permissions:\n      contents: read\n      actions: read\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(dependencyReviewReadPermission)).toThrow(
      /exact reviewed keys/u,
    );

    const extraCodeqlReadPermission = {
      ...documents,
      "security.yml": replaceRequired(
        documents["security.yml"],
        "    permissions:\n      contents: read\n      security-events: write\n",
        "    permissions:\n      contents: read\n      actions: read\n      security-events: write\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(extraCodeqlReadPermission)).toThrow(
      /codeql permissions/u,
    );

    const missingTimeout = {
      ...documents,
      "ci.yml": documents["ci.yml"].replace(/^ {4}timeout-minutes: \d+\n/mu, ""),
    };
    expect(() => validateWorkflowPolicyDocuments(missingTimeout)).toThrow(/timeout-minutes/u);

    const missingConcurrency = {
      ...documents,
      "security.yml": documents["security.yml"].replace(/^concurrency:\n(?: {2}.+\n){2}/mu, ""),
    };
    expect(() => validateWorkflowPolicyDocuments(missingConcurrency)).toThrow(/concurrency/u);

    const commentedConcurrencyDecoy = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"],
        "  group: ${{ github.workflow }}-${{ github.ref }}",
        "  group: global # ${{ github.workflow }}-${{ github.ref }}",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(commentedConcurrencyDecoy)).toThrow(
      /concurrency/u,
    );

    const filteredCi = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"],
        "  push:\n",
        '  push:\n    paths-ignore: ["**"]\n',
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(filteredCi)).toThrow(/trigger blocks/u);

    const continuedSecurityCondition = {
      ...documents,
      "security.yml": replaceRequired(
        documents["security.yml"],
        "    if: github.event_name == 'pull_request'\n",
        "    if: github.event_name == 'pull_request'\n      && false\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(continuedSecurityCondition)).toThrow(
      /scalar values cannot continue/u,
    );
  });

  it("keeps the exact Node matrix and complete ordered CI release gates", async () => {
    const documents = await loadWorkflowDocuments();
    const matrixDrift = {
      ...documents,
      "ci.yml": replaceRequired(documents["ci.yml"], 'node: ["22.5.0", "24"]', 'node: ["24"]'),
    };
    expect(() => validateWorkflowPolicyDocuments(matrixDrift)).toThrow(/Node matrix/u);

    const commentedMatrixDecoy = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"],
        '        node: ["22.5.0", "24"]',
        '        # node: ["22.5.0", "24"]\n        node: ["24"]',
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(commentedMatrixDecoy)).toThrow(/Node matrix/u);

    const misboundRuntimeInput = {
      ...documents,
      "ci.yml": replaceRequired(
        replaceRequired(
          documents["ci.yml"],
          "          node-version: ${{ matrix.node }}",
          "          cache: yarn",
        ),
        "          persist-credentials: false",
        "          persist-credentials: false\n          node-version: ${{ matrix.node }}",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(misboundRuntimeInput)).toThrow(/inputs/u);

    const missingGate = {
      ...documents,
      "ci.yml": replaceRequired(documents["ci.yml"], "      - run: yarn test:errors\n", ""),
    };
    expect(() => validateWorkflowPolicyDocuments(missingGate)).toThrow(/ordered release gate/u);

    const reorderedGate = {
      ...documents,
      "ci.yml": documents["ci.yml"].replace(
        "      - run: yarn lint\n      - run: yarn typecheck\n",
        "      - run: yarn typecheck\n      - run: yarn lint\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(reorderedGate)).toThrow(/ordered release gate/u);

    const continuedCommand = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"],
        "      - run: yarn test\n",
        "      - run: yarn test\n        ; true\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(continuedCommand)).toThrow(/single-line/u);

    const skippedGate = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"],
        "      - run: yarn test\n",
        "      - run: yarn test\n        continue-on-error: true\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(skippedGate)).toThrow(/gate-bypass control/u);

    const skippedJob = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"],
        "    timeout-minutes: 60\n",
        "    if: false\n    timeout-minutes: 60\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(skippedJob)).toThrow(/exact reviewed keys/u);

    const poisonedEnvironment = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"],
        "    env:\n",
        "    env:\n      PATH: ./untrusted-bin\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(poisonedEnvironment)).toThrow(
      /reviewed Node floor option/u,
    );

    const excludedFloor = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"],
        '        node: ["22.5.0", "24"]\n',
        '        node: ["22.5.0", "24"]\n        exclude:\n          - node: "22.5.0"\n',
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(excludedFloor)).toThrow(/gate-bypass control/u);
  });

  it("rejects privileged triggers, secret references and credential-persisting checkouts", async () => {
    const documents = await loadWorkflowDocuments();
    const privilegedTrigger = {
      ...documents,
      "security.yml": replaceRequired(
        documents["security.yml"],
        "  pull_request:\n",
        "  pull_request_target:\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(privilegedTrigger)).toThrow(
      /pull_request_target/u,
    );

    const secretReference = {
      ...documents,
      "ci.yml": `${documents["ci.yml"]}\n# \${{ secrets.NPM_TOKEN }}\n`,
    };
    expect(() => validateWorkflowPolicyDocuments(secretReference)).toThrow(/secret reference/u);

    const implicitTokenReference = {
      ...documents,
      "ci.yml": `${documents["ci.yml"]}\n# \${{ github.token }}\n`,
    };
    expect(() => validateWorkflowPolicyDocuments(implicitTokenReference)).toThrow(
      /secret reference/u,
    );

    const bracketTokenReference = {
      ...documents,
      "ci.yml": `${documents["ci.yml"]}\n# \${{ github['token'] }}\n`,
    };
    expect(() => validateWorkflowPolicyDocuments(bracketTokenReference)).toThrow(
      /secret reference/u,
    );

    const bracketSecretReference = {
      ...documents,
      "ci.yml": `${documents["ci.yml"]}\n# \${{ secrets['NPM_TOKEN'] }}\n`,
    };
    expect(() => validateWorkflowPolicyDocuments(bracketSecretReference)).toThrow(
      /secret reference/u,
    );

    const persistedCredentials = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"],
        "          persist-credentials: false",
        "          persist-credentials: true",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(persistedCredentials)).toThrow(
      /persist-credentials: false/u,
    );

    const duplicateCredentialSetting = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"],
        "          persist-credentials: false",
        "          persist-credentials: false\n          persist-credentials: true",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(duplicateCredentialSetting)).toThrow(
      /persist-credentials: false/u,
    );
  });

  it("requires both policy-bearing workflows", async () => {
    const documents = await loadWorkflowDocuments();
    delete documents["security.yml"];

    expect(() => validateWorkflowPolicyDocuments(documents)).toThrow(/security\.yml/u);

    const completeDocuments = await loadWorkflowDocuments();
    completeDocuments["backdoor.yml"] = completeDocuments["security.yml"];
    expect(() => validateWorkflowPolicyDocuments(completeDocuments)).toThrow(
      /workflow inventory must be exactly/u,
    );
  });

  it("rejects YAML structures that bypass line-oriented policy checks", async () => {
    const documents = await loadWorkflowDocuments();
    const flowJob = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"],
        "  quality:\n",
        "  bypass: { runs-on: ubuntu-24.04, timeout-minutes: 1, steps: [] }\n  quality:\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(flowJob)).toThrow(/unsupported job declaration/u);

    const mergedJob = {
      ...documents,
      "security.yml": replaceRequired(
        documents["security.yml"],
        "    timeout-minutes: 20\n",
        "    <<: *privileged-job\n    timeout-minutes: 20\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(mergedJob)).toThrow(/unsupported YAML/u);

    const flowTrigger = {
      ...documents,
      "ci.yml": replaceRequired(documents["ci.yml"], "on:\n", "on: [pull_request_target]\n"),
    };
    expect(() => validateWorkflowPolicyDocuments(flowTrigger)).toThrow(/unsupported YAML/u);

    const securityShell = {
      ...documents,
      "security.yml": replaceRequired(
        documents["security.yml"],
        "      - uses: actions/dependency-review-action@",
        "      - run: uname -a\n      - uses: actions/dependency-review-action@",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(securityShell)).toThrow(
      /cannot add shell commands/u,
    );

    const namedActionStep = {
      ...documents,
      "security.yml": replaceRequired(
        documents["security.yml"],
        "      - uses: actions/dependency-review-action@",
        "      - name: hidden action\n        uses: untrusted/review@v1\n      - uses: actions/dependency-review-action@",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(namedActionStep)).toThrow(/unsupported YAML/u);

    const namedRunStep = {
      ...documents,
      "security.yml": replaceRequired(
        documents["security.yml"],
        "      - uses: actions/dependency-review-action@",
        "      - name: hidden command\n        run: uname -a\n      - uses: actions/dependency-review-action@",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(namedRunStep)).toThrow(/unsupported YAML/u);

    const unreviewedActionInput = {
      ...documents,
      "security.yml": documents["security.yml"].replace(
        /(- uses: actions\/dependency-review-action@[0-9a-f]{40} # v5\.0\.0)/u,
        "$1\n        with:\n          allow-ghsas: '*'",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(unreviewedActionInput)).toThrow(
      /unreviewed inputs/u,
    );

    const commentedCodeqlDecoy = {
      ...documents,
      "security.yml": replaceRequired(
        documents["security.yml"],
        '        language: ["javascript-typescript"]',
        '        # language: ["javascript-typescript"]\n        language: ["csharp"]',
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(commentedCodeqlDecoy)).toThrow(/CodeQL matrix/u);

    const duplicateActionKey = {
      ...documents,
      "ci.yml": documents["ci.yml"].replace(
        /(- uses: actions\/checkout@[0-9a-f]{40} # v7\.0\.1)/u,
        "$1\n        uses: untrusted/checkout@v1",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(duplicateActionKey)).toThrow(/unsupported YAML/u);

    const explicitActionKey = {
      ...documents,
      "security.yml": replaceRequired(
        documents["security.yml"],
        "      - uses: actions/dependency-review-action@",
        "      - ? uses\n        : untrusted/review@v1\n      - uses: actions/dependency-review-action@",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(explicitActionKey)).toThrow(/unsupported YAML/u);

    const anchoredRunStep = {
      ...documents,
      "security.yml": replaceRequired(
        documents["security.yml"],
        "      - uses: actions/dependency-review-action@",
        "      - &hidden run: uname -a\n      - uses: actions/dependency-review-action@",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(anchoredRunStep)).toThrow(/unsupported YAML/u);

    const punctuatedAnchor = {
      ...documents,
      "ci.yml": replaceRequired(documents["ci.yml"], "name: CI", "name: &.reviewed CI"),
    };
    expect(() => validateWorkflowPolicyDocuments(punctuatedAnchor)).toThrow(/unsupported YAML/u);

    const foldedRunnerContinuation = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"],
        "    runs-on: ubuntu-24.04\n",
        "    runs-on: ubuntu-24.04\n      x:y\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(foldedRunnerContinuation)).toThrow(
      /scalar values cannot continue/u,
    );

    const blockScalarGateDecoy = {
      ...documents,
      "ci.yml": replaceRequired(
        documents["ci.yml"].replace(/^ {6}(- run: .+)$/gmu, "          $1"),
        "          node-version: ${{ matrix.node }}\n",
        "          node-version: ${{ matrix.node }}\n        name: !!str |\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(blockScalarGateDecoy)).toThrow(/block scalars/u);
  });

  it("publishes bounded vulnerability and dependency-update policies", async () => {
    const [securityPolicy, dependabotPolicy] = await Promise.all([
      readFile(path.join(repositoryRoot, "SECURITY.md"), "utf8"),
      readFile(path.join(repositoryRoot, ".github", "dependabot.yml"), "utf8"),
    ]);

    expect(securityPolicy).toContain("Do not open a public issue");
    expect(securityPolicy).toContain("within five business days");
    expect(securityPolicy).toContain("within ten business days");
    expect(securityPolicy).toContain("[REDACTED]");
    expect(securityPolicy).toContain("trusted single-user local stdio");
    expect(securityPolicy).toContain("GNU coreutils");
    expect(securityPolicy).toContain("--update=none-fail");
    expect(securityPolicy).toContain("macOS, Windows");
    expect(securityPolicy).toContain("unverified");
    expect(securityPolicy).toContain(
      "macOS, Windows and Linux systems without that primitive are unverified.",
    );
    expect(securityPolicy).not.toMatch(/\/(?:home|Users)\//u);

    expect(dependabotPolicy.match(/package-ecosystem:/gu)).toHaveLength(2);
    expect(dependabotPolicy.match(/directory: "\/"/gu)).toHaveLength(2);
    expect(dependabotPolicy).toContain("package-ecosystem: npm");
    expect(dependabotPolicy).toContain("package-ecosystem: github-actions");
    expect(dependabotPolicy.match(/interval: weekly/gu)).toHaveLength(2);
    expect(dependabotPolicy).toContain("open-pull-requests-limit: 5");
    expect(dependabotPolicy).toContain("open-pull-requests-limit: 3");
    expect(dependabotPolicy).not.toMatch(/\$\{\{\s*secrets/u);
  });
});
