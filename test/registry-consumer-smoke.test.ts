import { chmod, copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTwoFilesPatch } from "diff";
import { afterEach, describe, expect, it } from "vitest";

import {
  createFakeAgents,
  preparePreviewApplyReplay,
} from "../scripts/registry-consumer-smoke.mjs";
import { detectInstalledAgents } from "../src/services/agent-setup.js";

const OPERATION_ID = "12345678-1234-4123-8123-123456789abc";
const PLAN_HASH = "a".repeat(64);
const CORRELATION_ID = "87654321-4321-4321-8321-cba987654321";
const SOURCE_FILE = "src/value.ts";
const BEFORE = "export const value = 'before';\n";
const EXPECTED = "export const value = 'after';\n";
const temporaryRoots: string[] = [];

type MutationPhase = "prepare" | "mismatch" | "preview";
type MutationOutcome = "response" | "throw";

function preparedResult(projectRoot: string) {
  return {
    structuredContent: {
      kind: "rename_symbol",
      status: "prepared",
      blocked: false,
      block_reason: null,
      operation_id: OPERATION_ID,
      plan_hash: PLAN_HASH,
      project_root: projectRoot,
      affected_files: [{ file: SOURCE_FILE }],
      diagnostics: { added_errors: [] },
      allow_new_errors: false,
    },
  };
}

function conflictResult() {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: {
            code: "CONFLICT",
            correlation_id: CORRELATION_ID,
            message: "The prepared operation hash does not match.",
          },
        }),
      },
    ],
  };
}

function previewResult(postimage: string = EXPECTED) {
  return {
    structuredContent: {
      operation_id: OPERATION_ID,
      plan_hash: PLAN_HASH,
      files: [
        {
          file: SOURCE_FILE,
          diff: createTwoFilesPatch(SOURCE_FILE, SOURCE_FILE, BEFORE, postimage),
        },
      ],
    },
  };
}

function appliedResult(idempotentReplay: boolean) {
  return {
    structuredContent: {
      operation_id: OPERATION_ID,
      kind: "rename_symbol",
      status: "applied",
      applied_at: "2026-08-11T00:00:00.000Z",
      affected_files: [SOURCE_FILE],
      idempotent_replay: idempotentReplay,
    },
  };
}

async function fixture() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ast-mcp-registry-smoke-test-"));
  temporaryRoots.push(projectRoot);
  const sourcePath = path.join(projectRoot, SOURCE_FILE);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, BEFORE);
  return { projectRoot, sourcePath };
}

function runEvidence(client: { callTool(): Promise<unknown> }, projectRoot: string) {
  return preparePreviewApplyReplay(
    client,
    "ast_rename_symbol",
    { project_root: projectRoot },
    "rename_symbol",
    [SOURCE_FILE],
    { [SOURCE_FILE]: EXPECTED },
  );
}

describe("registry consumer mutation evidence", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("reproduces symlink identity collapse and preserves physical copy identities", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ast-mcp-registry-agent-test-"));
    temporaryRoots.push(root);
    const symlinkRoot = path.join(root, "symlinked");
    const symlinkBin = path.join(symlinkRoot, "fake-bin");
    const fakeAgentSource = path.resolve(process.cwd(), "scripts", "fixtures", "fake-agent.mjs");
    const symlinkTarget = path.join(symlinkBin, "fake-agent.mjs");
    await mkdir(symlinkBin, { recursive: true });
    await copyFile(fakeAgentSource, symlinkTarget);
    await chmod(symlinkTarget, 0o755);
    await Promise.all(
      ["claude", "hermes"].map((name) => symlink(symlinkTarget, path.join(symlinkBin, name))),
    );

    const symlinkDetections = await detectInstalledAgents({
      environment: {
        ...process.env,
        PATH: `${symlinkBin}${path.delimiter}${path.dirname(process.execPath)}`,
        FAKE_CLAUDE_STATE: path.join(symlinkRoot, "claude-state.json"),
        FAKE_HERMES_STATE: path.join(symlinkRoot, "hermes-state.json"),
      },
    });
    expect(
      symlinkDetections.map(({ id, installed, executable, version }) => ({
        id,
        installed,
        executable: executable === undefined ? undefined : path.basename(executable),
        version,
      })),
    ).toEqual([
      {
        id: "claude",
        installed: true,
        executable: "fake-agent.mjs",
        version: "Hermes Agent v0.17.0",
      },
      {
        id: "hermes",
        installed: true,
        executable: "fake-agent.mjs",
        version: "Hermes Agent v0.17.0",
      },
      { id: "opencode", installed: false, executable: undefined, version: undefined },
      { id: "codex", installed: true, executable: "codex.js", version: "codex-cli 0.144.0" },
      { id: "gemini", installed: false, executable: undefined, version: undefined },
      { id: "copilot", installed: false, executable: undefined, version: undefined },
    ]);

    const copyRoot = path.join(root, "copied");
    const copyBin = await createFakeAgents(copyRoot);
    const copyDetections = await detectInstalledAgents({
      environment: {
        ...process.env,
        PATH: `${copyBin}${path.delimiter}${path.dirname(process.execPath)}`,
        FAKE_CLAUDE_STATE: path.join(copyRoot, "claude-state.json"),
        FAKE_HERMES_STATE: path.join(copyRoot, "hermes-state.json"),
      },
    });

    expect(
      copyDetections.map(({ id, installed, executable, version }) => ({
        id,
        installed,
        executable: executable === undefined ? undefined : path.basename(executable),
        version,
      })),
    ).toEqual([
      {
        id: "claude",
        installed: true,
        executable: "claude",
        version: "2.1.201 (Claude Code)",
      },
      {
        id: "hermes",
        installed: true,
        executable: "hermes",
        version: "Hermes Agent v0.17.0",
      },
      { id: "opencode", installed: false, executable: undefined, version: undefined },
      { id: "codex", installed: true, executable: "codex.js", version: "codex-cli 0.144.0" },
      { id: "gemini", installed: false, executable: undefined, version: undefined },
      { id: "copilot", installed: false, executable: undefined, version: undefined },
    ]);
  });

  it.each(
    (["prepare", "mismatch", "preview"] as const).flatMap((phase) =>
      (["response", "throw"] as const).map((outcome) => [phase, outcome] as const),
    ),
  )(
    "rejects a %s %s that mutates before authorized apply",
    async (mutationPhase: MutationPhase, mutationOutcome: MutationOutcome) => {
      const { projectRoot, sourcePath } = await fixture();

      let call = 0;
      const client = {
        async callTool() {
          call += 1;
          const phase: MutationPhase = call === 1 ? "prepare" : call === 2 ? "mismatch" : "preview";
          if (phase === mutationPhase) {
            await writeFile(sourcePath, `export const value = '${phase} mutation';\n`);
            if (mutationOutcome === "throw") throw new Error(`${phase} failed after mutation`);
          }
          if (phase === "prepare") return preparedResult(projectRoot);
          if (phase === "mismatch") return conflictResult();
          return previewResult();
        },
      };

      await expect(runEvidence(client, projectRoot)).rejects.toThrow(
        /changed files before an authorized apply/u,
      );
    },
  );

  it("accepts exact preview/apply postimages and an exact idempotent replay", async () => {
    const { projectRoot, sourcePath } = await fixture();
    let call = 0;
    const client = {
      async callTool() {
        call += 1;
        if (call === 1) return preparedResult(projectRoot);
        if (call === 2) return conflictResult();
        if (call === 3) return previewResult();
        if (call === 4) {
          await writeFile(sourcePath, EXPECTED);
          return appliedResult(false);
        }
        return appliedResult(true);
      },
    };

    await expect(runEvidence(client, projectRoot)).resolves.toBeUndefined();
  });

  it("rejects a marker-only preview that does not reconstruct the reviewed postimage", async () => {
    const { projectRoot } = await fixture();
    let call = 0;
    const client = {
      async callTool() {
        call += 1;
        if (call === 1) return preparedResult(projectRoot);
        if (call === 2) return conflictResult();
        return previewResult("// after\n");
      },
    };

    await expect(runEvidence(client, projectRoot)).rejects.toThrow(
      /preview does not reconstruct the exact reviewed postimage/u,
    );
  });

  it("rejects a marker-only apply even when the receipt reports success", async () => {
    const { projectRoot, sourcePath } = await fixture();
    let call = 0;
    const client = {
      async callTool() {
        call += 1;
        if (call === 1) return preparedResult(projectRoot);
        if (call === 2) return conflictResult();
        if (call === 3) return previewResult();
        await writeFile(sourcePath, "// after\n");
        return appliedResult(false);
      },
    };

    await expect(runEvidence(client, projectRoot)).rejects.toThrow(
      /apply did not produce the exact reviewed postimages/u,
    );
  });
});
