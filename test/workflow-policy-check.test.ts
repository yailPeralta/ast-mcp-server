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
  it("accepts the complete pinned Linux CI, security, and release policy", async () => {
    const documents = await loadWorkflowDocuments();

    expect(validateWorkflowPolicyDocuments(documents)).toEqual({
      status: "pass",
      workflow_count: 3,
      job_count: 9,
      action_count: 23,
      workflows: ["ci.yml", "release.yml", "security.yml"],
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

  it("closes release dispatch, concurrency, jobs, permissions, and mode conditions", async () => {
    const documents = await loadWorkflowDocuments();
    const release = documents["release.yml"];
    expect(release).toBeTypeOf("string");
    if (typeof release !== "string") return;

    expect(release).toContain("  group: ${{ github.workflow }}\n");
    const versionSplitConcurrency = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "  group: ${{ github.workflow }}",
        "  group: ${{ github.workflow }}-${{ inputs.version }}",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(versionSplitConcurrency)).toThrow(
      /release concurrency/u,
    );

    const triggerDrift = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "on:\n  workflow_dispatch:\n",
        "on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(triggerDrift)).toThrow(/release trigger block/u);

    const cancelPublish = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "  cancel-in-progress: false",
        "  cancel-in-progress: true",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(cancelPublish)).toThrow(/release concurrency/u);

    const invalidModeCanSkip = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "  validate-dispatch:\n",
        "  validate-dispatch-disabled:\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(invalidModeCanSkip)).toThrow(
      /release job inventory/u,
    );

    const conditionDrift = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "    if: inputs.mode == 'verify-next'",
        "    if: inputs.mode != 'publish-next'",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(conditionDrift)).toThrow(/verify-next condition/u);

    const oidcOnVerifier = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "  verify-next:\n    needs: validate-dispatch\n",
        "  verify-next:\n    needs: validate-dispatch\n    permissions:\n      contents: read\n      id-token: write\n",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(oidcOnVerifier)).toThrow(/verify-next.*keys/u);

    const missingEnvironment = {
      ...documents,
      "release.yml": replaceRequired(release, "    environment: production\n", ""),
    };
    expect(() => validateWorkflowPolicyDocuments(missingEnvironment)).toThrow(
      /protected Environments/u,
    );

    const inputControlledCheckout = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "          ref: ${{ github.sha }}",
        "          ref: ${{ inputs.sha }}",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(inputControlledCheckout)).toThrow(
      /checkout inputs/u,
    );

    const checkoutBeforeIdentity = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        '      - run: test "$GITHUB_REF" = refs/heads/main && test "$RELEASE_SHA" = "$GITHUB_SHA"\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          ref: ${{ github.sha }}\n          persist-credentials: false',
        '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          ref: ${{ github.sha }}\n          persist-credentials: false\n      - run: test "$GITHUB_REF" = refs/heads/main && test "$RELEASE_SHA" = "$GITHUB_SHA"',
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(checkoutBeforeIdentity)).toThrow(/step chain/u);

    const missingPreinstallEnvironmentBoundary = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "      - run: node scripts/release-preflight.mjs validate-environment\n      - run: node scripts/release-preflight.mjs authorize-publish",
        "      - run: node scripts/release-preflight.mjs authorize-publish",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(missingPreinstallEnvironmentBoundary)).toThrow(
      /token references|command chain|step chain/u,
    );

    const environmentBoundaryAfterInstall = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        '      - run: node scripts/release-preflight.mjs validate-environment\n      - run: node scripts/release-preflight.mjs authorize-publish\n        env:\n          GITHUB_TOKEN: ${{ github.token }}\n      - run: env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" corepack enable\n      - run: env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" yarn install --immutable --mode=skip-build',
        '      - run: node scripts/release-preflight.mjs authorize-publish\n        env:\n          GITHUB_TOKEN: ${{ github.token }}\n      - run: env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" corepack enable\n      - run: env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" yarn install --immutable --mode=skip-build\n      - run: node scripts/release-preflight.mjs validate-environment',
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(environmentBoundaryAfterInstall)).toThrow(
      /command chain|step chain/u,
    );

    const oidcOnPreparationJob = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "    permissions:\n      contents: read\n      actions: read\n    runs-on: ubuntu-24.04\n    timeout-minutes: 30",
        "    permissions:\n      contents: read\n      actions: read\n      id-token: write\n    runs-on: ubuntu-24.04\n    timeout-minutes: 30",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(oidcOnPreparationJob)).toThrow(
      /prepare-publish permissions|nested keys/u,
    );

    const oidcOnPublishValidator = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "env -u ACTIONS_ID_TOKEN_REQUEST_TOKEN -u ACTIONS_ID_TOKEN_REQUEST_URL node scripts/release-preflight.mjs validate-environment",
        "node scripts/release-preflight.mjs validate-environment",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(oidcOnPublishValidator)).toThrow(
      /command chain|step chain/u,
    );

    const extraJob = {
      ...documents,
      "release.yml": `${release}\n  bypass:\n    runs-on: ubuntu-24.04\n`,
    };
    expect(() => validateWorkflowPolicyDocuments(extraJob)).toThrow(/release job inventory/u);
  });

  it("closes release action, input, command, environment, and token topology", async () => {
    const documents = await loadWorkflowDocuments();
    const release = documents["release.yml"];
    expect(release).toBeTypeOf("string");
    if (typeof release !== "string") return;

    expect(release).toContain(
      "      - run: node scripts/release-preflight.mjs validate-promotion\n        env:\n          GITHUB_TOKEN: ${{ github.token }}",
    );
    expect(release).toContain(
      "      - run: node scripts/release-preflight.mjs promote-latest\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
    );
    expect(release).not.toMatch(/^ {6}(?:GITHUB_TOKEN|NODE_AUTH_TOKEN):/mu);
    expect(release).toContain(
      '      - run: env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" yarn install --immutable --mode=skip-build',
    );

    const ambientEnvironmentExposedToInstall = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        '      - run: env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" yarn install --immutable --mode=skip-build',
        "      - run: yarn install --immutable --mode=skip-build",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(ambientEnvironmentExposedToInstall)).toThrow(
      /command chain|step chain/u,
    );

    const ambientEnvironmentExposedToCorepack = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        '      - run: env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" corepack enable',
        "      - run: corepack enable",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(ambientEnvironmentExposedToCorepack)).toThrow(
      /command chain|step chain/u,
    );

    const lifecycleEnabledInstall = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        '      - run: env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" yarn install --immutable --mode=skip-build',
        '      - run: env -i HOME="$HOME" PATH="$PATH" CI=true RUNNER_TEMP="$RUNNER_TEMP" TMPDIR="$RUNNER_TEMP" yarn install --immutable',
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(lifecycleEnabledInstall)).toThrow(
      /command chain|step chain/u,
    );

    const credentialIsolationDrift = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "      - run: node scripts/release-preflight.mjs promote-latest\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
        "      - run: node scripts/release-preflight.mjs promote-latest\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n          GITHUB_TOKEN: ${{ github.token }}",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(credentialIsolationDrift)).toThrow(
      /token references|credential references|step credential isolation|environment must match/u,
    );

    const unreviewedArtifactAction = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
        `actions/upload-artifact@${"c".repeat(40)}`,
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(unreviewedArtifactAction)).toThrow(
      /reviewed revision/u,
    );

    const missingArtifactRunId = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "          run-id: ${{ inputs.verification_run_id }}\n",
        "",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(missingArtifactRunId)).toThrow(
      /download-artifact inputs/u,
    );

    const artifactPathDrift = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "          path: ${{ env.RELEASE_EVIDENCE_ROOT }}",
        "          path: /tmp/release-evidence",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(artifactPathDrift)).toThrow(/artifact inputs/u);

    const commandInjection = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "      - run: node scripts/release-preflight.mjs validate-dispatch",
        "      - run: node scripts/release-preflight.mjs validate-dispatch && npm publish",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(commandInjection)).toThrow(
      /validate-dispatch command chain/u,
    );

    const publishSecret = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "      - run: node scripts/release-preflight.mjs authorize-publish\n        env:\n          GITHUB_TOKEN: ${{ github.token }}",
        "      - run: node scripts/release-preflight.mjs authorize-publish\n        env:\n          GITHUB_TOKEN: ${{ github.token }}\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(publishSecret)).toThrow(
      /token references|credential references|step credential isolation|environment must match/u,
    );

    const bracketToken = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "${{ secrets.NPM_TOKEN }}",
        "${{ secrets['NPM_TOKEN'] }}",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(bracketToken)).toThrow(/token reference/u);

    const tokenInArgument = {
      ...documents,
      "release.yml": replaceRequired(
        release,
        "      - run: node scripts/release-preflight.mjs promote-latest",
        "      - run: node scripts/release-preflight.mjs promote-latest --token ${{ secrets.NPM_TOKEN }}",
      ),
    };
    expect(() => validateWorkflowPolicyDocuments(tokenInArgument)).toThrow(/token reference/u);
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

  it.each([
    [
      "release checkout",
      "release.yml",
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    ],
    [
      "release upload",
      "release.yml",
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1",
    ],
    [
      "release download",
      "release.yml",
      "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1",
    ],
    [
      "dependency review",
      "security.yml",
      "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294 # v5.0.0",
    ],
    [
      "CodeQL init",
      "security.yml",
      "github/codeql-action/init@5595ccaf912efad79be6eef63a5619ff05969be3 # v4.37.6",
    ],
    [
      "CodeQL analyze",
      "security.yml",
      "github/codeql-action/analyze@5595ccaf912efad79be6eef63a5619ff05969be3 # v4.37.6",
    ],
  ])("rejects a conditional skip on the %s action", async (_label, workflowName, marker) => {
    const documents = await loadWorkflowDocuments();
    const source = documents[workflowName];
    expect(source).toBeTypeOf("string");
    if (typeof source !== "string") return;
    const conditional = {
      ...documents,
      [workflowName]: replaceRequired(source, marker, `${marker}\n        if: false`),
    };
    expect(() => validateWorkflowPolicyDocuments(conditional)).toThrow(
      /action step keys|condition only dependency review/u,
    );
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
      /action step keys|unreviewed inputs/u,
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
    expect(securityPolicy).toContain("Linux x64 only");
    expect(securityPolicy).toContain("Other Linux architectures");
    expect(securityPolicy).toContain("systems without that primitive");
    expect(securityPolicy).toContain("macOS and Windows");
    expect(securityPolicy).toContain("unverified");
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
