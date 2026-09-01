import {
  access,
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyOperation,
  clearOperationsForTests,
  configureOperationApply,
  exportOperationRecord,
  getOperationPreview,
  importOperationRecord,
  prepareRename,
  prepareReplaceBody,
  prepareScaffoldClass,
  setOperationStoreConfigForTests,
  setOperationTestHooksForTests,
} from "../src/services/operations.js";
import {
  clearProjectSessions,
  getProjectOperationQueueSnapshot,
  getProjectSessionRegistrySnapshot,
  invalidateProject,
  withProjectOperation,
} from "../src/services/project.js";
import { classifyPublicError } from "../src/services/public-errors.js";
import { createRequestContext } from "../src/services/request-context.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];
const mutationEnvironmentRoots: string[] = [];

beforeEach(async () => {
  const environmentRoot = await mkdtemp(path.join(os.tmpdir(), "ast-operation-env-"));
  mutationEnvironmentRoots.push(environmentRoot);
  vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", undefined);
  vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", undefined);
  vi.stubEnv("HOME", path.join(environmentRoot, "home"));
  vi.stubEnv("XDG_CACHE_HOME", path.join(environmentRoot, "xdg"));
});

afterEach(async () => {
  clearOperationsForTests();
  clearProjectSessions();
  const environmentRoots = mutationEnvironmentRoots.splice(0);
  try {
    for (const environmentRoot of environmentRoots) {
      const cacheRoot = path.join(environmentRoot, "xdg", "ast-mcp-server", "symbol-index");
      await expect(access(cacheRoot)).rejects.toMatchObject({ code: "ENOENT" });
    }
  } finally {
    vi.unstubAllEnvs();
    await Promise.all([
      ...fixtures.splice(0).map((fixture) => fixture.cleanup()),
      ...environmentRoots.map((root) => rm(root, { recursive: true, force: true })),
    ]);
  }
});

async function renameFixture(): Promise<ProjectFixture> {
  const fixture = await createProjectFixture({
    "src/value.ts": `export function formatValue(value: number): string { return String(value); }\n`,
    "src/use.ts": `import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n`,
  });
  fixtures.push(fixture);
  return fixture;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("Expected promise to reject.");
    },
    (error: unknown) => error,
  );
}

type FilePhaseEvent = {
  operationId: string;
  file: string;
  index: number;
  phase: "capability-preflight" | "before-publish" | "after-commit" | "before-rollback";
};

function holdFilePhase(predicate: (event: FilePhaseEvent) => boolean) {
  let arrive!: () => void;
  const reached = new Promise<void>((resolve) => (arrive = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  setOperationTestHooksForTests({
    onFilePhase: async (event) => {
      if (!predicate(event)) return;
      arrive();
      await released;
    },
  });
  return { reached, release };
}

async function oneFileReplacement() {
  const fixture = await createProjectFixture({
    "src/value.ts": "export function value(): string { return 'original'; }\n",
  });
  fixtures.push(fixture);
  const prepared = await prepareReplaceBody({
    projectRoot: fixture.root,
    filePath: "src/value.ts",
    symbolPath: "value",
    newBody: "return 'ast';",
  });
  return { fixture, prepared, target: path.join(fixture.root, "src/value.ts") };
}

function scaffoldSpec() {
  return {
    className: "UserService",
    imports: [],
    implements: [],
    decorators: [],
    constructorParams: [],
    properties: [],
    methods: [
      {
        name: "findUser",
        isAsync: true,
        params: [{ name: "id", type: "string" }],
        returnType: "Promise<string>",
      },
    ],
  };
}

describe("prepared structural operations", () => {
  it("prepares exact multi-file rename edits and applies them idempotently", async () => {
    const fixture = await renameFixture();
    const xdgCacheHome = path.join(fixture.root, ".xdg-cache");
    const cacheRoot = path.join(xdgCacheHome, "ast-mcp-server", "symbol-index");
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", undefined);
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", undefined);
    vi.stubEnv("XDG_CACHE_HOME", xdgCacheHome);
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });

    expect(prepared.status).toBe("prepared");
    expect(prepared.blocked).toBe(false);
    expect(prepared.reference_count).toBe(2);
    expect(prepared.affected_files.map((file) => file.file)).toEqual([
      "src/use.ts",
      "src/value.ts",
    ]);
    expect(prepared.preview).toContain("renderValue");
    expect(await fixture.read("src/value.ts")).toContain("formatValue");
    await expect(access(cacheRoot)).rejects.toMatchObject({ code: "ENOENT" });

    const applied = await applyOperation(prepared.operation_id, prepared.plan_hash);
    expect(applied.idempotent_replay).toBe(false);
    expect(await fixture.read("src/value.ts")).toContain("renderValue");
    expect(await fixture.read("src/use.ts")).toContain("renderValue");
    expect(getProjectSessionRegistrySnapshot()).toMatchObject({
      session_count: 0,
      active_sessions: 0,
    });
    await expect(access(cacheRoot)).rejects.toMatchObject({ code: "ENOENT" });

    const replay = await applyOperation(prepared.operation_id, prepared.plan_hash);
    expect(replay.idempotent_replay).toBe(true);
    await expect(access(cacheRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes every prepared-operation kind when cancellation wins after retention", async () => {
    const fixture = await renameFixture();
    const preparations = [
      (requestContext: ReturnType<typeof createRequestContext>) =>
        prepareRename(
          {
            projectRoot: fixture.root,
            filePath: "src/value.ts",
            symbolPath: "formatValue",
            newName: "renderValue",
          },
          requestContext,
        ),
      (requestContext: ReturnType<typeof createRequestContext>) =>
        prepareReplaceBody(
          {
            projectRoot: fixture.root,
            filePath: "src/value.ts",
            symbolPath: "formatValue",
            newBody: "return `value:${value}`;",
          },
          requestContext,
        ),
      (requestContext: ReturnType<typeof createRequestContext>) =>
        prepareScaffoldClass(
          {
            projectRoot: fixture.root,
            filePath: "src/user-service.ts",
            spec: scaffoldSpec(),
          },
          requestContext,
        ),
    ];

    for (const prepare of preparations) {
      const controller = new AbortController();
      let retainedOperationId: string | undefined;
      setOperationTestHooksForTests({
        afterRetain: (operationId) => {
          retainedOperationId = operationId;
          controller.abort();
        },
      });

      await expect(prepare(createRequestContext(controller.signal))).rejects.toMatchObject({
        code: "REQUEST_CANCELLED",
      });
      expect(retainedOperationId).toBeDefined();
      await expect(
        Promise.resolve().then(() => getOperationPreview(retainedOperationId!)),
      ).rejects.toThrow(/not found or has expired/);
      clearOperationsForTests();
    }
  });

  it("serializes operation previews through the project scheduler", async () => {
    const fixture = await renameFixture();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    let markBlockerStarted!: () => void;
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    let releaseBlocker!: () => void;
    const blockerRelease = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blocker = withProjectOperation(fixture.root, async () => {
      markBlockerStarted();
      await blockerRelease;
    });
    await blockerStarted;
    const controller = new AbortController();
    const preview = Promise.resolve().then(() =>
      getOperationPreview(
        prepared.operation_id,
        undefined,
        createRequestContext(controller.signal),
      ),
    );
    await Promise.resolve();

    try {
      expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
        active_operations: 1,
        queued_operations: 1,
      });
      controller.abort();
      await expect(preview).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    } finally {
      releaseBlocker();
    }
    await blocker;
  });

  it("enforces the server execution deadline while building an operation preview", async () => {
    const fixture = await renameFixture();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    clearProjectSessions();
    vi.stubEnv("AST_OPERATION_DEADLINE_MS", "1000");
    let now = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => (now += 250));
    try {
      await expect(getOperationPreview(prepared.operation_id)).rejects.toMatchObject({
        code: "OPERATION_DEADLINE_EXCEEDED",
      });
      expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
        active_operations: 0,
        deadline_exceeded_operations: 1,
        last_outcome: "deadline_exceeded",
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("ignores cancellation after the first source write until apply is consistent", async () => {
    const fixture = await renameFixture();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    const controller = new AbortController();

    let markPostWrite!: () => void;
    const postWrite = new Promise<void>((resolve) => {
      markPostWrite = resolve;
    });
    let releasePostWrite!: () => void;
    const release = new Promise<void>((resolve) => {
      releasePostWrite = resolve;
    });
    setOperationTestHooksForTests({
      onFilePhase: async ({ index, phase }) => {
        if (phase !== "after-commit" || index !== 0) return;
        controller.abort();
        markPostWrite();
        await release;
      },
    });

    const applying = applyOperation(
      prepared.operation_id,
      prepared.plan_hash,
      createRequestContext(controller.signal),
    );
    const terminal = applying.then((result) => {
      expect(result).toMatchObject({ status: "applied", idempotent_replay: false });
      return result;
    });
    let settled = false;
    void terminal.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await postWrite;
      await Promise.resolve();
      expect(controller.signal.aborted).toBe(true);
      expect(settled).toBe(false);
      expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
        active_operations: 1,
        queued_operations: 0,
        cancelled_operations: 1,
        deadline_exceeded_operations: 0,
      });
      expect(getProjectSessionRegistrySnapshot()).toMatchObject({
        session_count: 1,
        active_sessions: 1,
      });
    } finally {
      releasePostWrite();
    }

    await terminal;
    expect(await fixture.read("src/value.ts")).toContain("renderValue");
    expect(await fixture.read("src/use.ts")).toContain("renderValue");
    expect(getProjectSessionRegistrySnapshot()).toMatchObject({
      session_count: 1,
      active_sessions: 0,
    });
  });

  it("does not orphan a queued same-project operation after apply completes", async () => {
    const fixture = await renameFixture();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    let markPostWrite!: () => void;
    const postWrite = new Promise<void>((resolve) => {
      markPostWrite = resolve;
    });
    let releasePostWrite!: () => void;
    const postWriteRelease = new Promise<void>((resolve) => {
      releasePostWrite = resolve;
    });
    setOperationTestHooksForTests({
      onFilePhase: async ({ index, phase }) => {
        if (phase !== "after-commit" || index !== 0) return;
        markPostWrite();
        await postWriteRelease;
      },
    });
    const applying = applyOperation(prepared.operation_id, prepared.plan_hash);
    await postWrite;

    let markSiblingStarted!: () => void;
    const siblingStarted = new Promise<void>((resolve) => {
      markSiblingStarted = resolve;
    });
    let releaseSibling!: () => void;
    const siblingRelease = new Promise<void>((resolve) => {
      releaseSibling = resolve;
    });
    const sibling = withProjectOperation(fixture.root, async () => {
      markSiblingStarted();
      await siblingRelease;
      return "sibling";
    });
    releasePostWrite();
    await applying;
    await siblingStarted;

    const third = withProjectOperation(fixture.root, () => "third");
    try {
      expect(getProjectSessionRegistrySnapshot()).toMatchObject({
        session_count: 1,
        active_sessions: 1,
      });
      expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
        active_operations: 1,
        queued_operations: 1,
      });
    } finally {
      releaseSibling();
    }
    await expect(sibling).resolves.toBe("sibling");
    await expect(third).resolves.toBe("third");
  });

  it("keeps prepare and apply independent from the opt-in persistence backend", async () => {
    const fixture = await renameFixture();
    const cacheRoot = path.join(fixture.root, ".symbol-index-cache");
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", cacheRoot);

    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });

    expect(prepared).toMatchObject({
      status: "prepared",
      blocked: false,
      block_reason: null,
      reference_count: 2,
      diagnostics: { addedErrors: [] },
    });
    await expect(access(cacheRoot)).rejects.toThrow();

    await expect(applyOperation(prepared.operation_id, prepared.plan_hash)).resolves.toMatchObject({
      status: "applied",
      idempotent_replay: false,
    });
    await expect(access(cacheRoot)).rejects.toThrow();
    expect(await fixture.read("src/value.ts")).toContain("renderValue");
    expect(await fixture.read("src/use.ts")).toContain("renderValue");
  });

  it("replacement preserves a substituted destination after final authentication", async () => {
    const { fixture, prepared, target } = await oneFileReplacement();
    const barrier = holdFilePhase(
      ({ operationId, phase }) =>
        operationId === prepared.operation_id && phase === "before-publish",
    );
    const applying = applyOperation(prepared.operation_id, prepared.plan_hash);
    await barrier.reached;
    await unlink(target);
    await writeFile(target, "export const externalReplacement = true;\n");
    barrier.release();
    const error = await applying.then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(await fixture.read("src/value.ts")).toBe("export const externalReplacement = true;\n");
    expect(classifyPublicError(error)).toMatchObject({ code: "CONFLICT" });
  });

  it("same-inode bytes and mode edits remain current after final authentication", async () => {
    const { fixture, prepared, target } = await oneFileReplacement();
    const before = await stat(target);
    const barrier = holdFilePhase(
      ({ operationId, phase }) =>
        operationId === prepared.operation_id && phase === "before-publish",
    );
    const applying = applyOperation(prepared.operation_id, prepared.plan_hash);
    await barrier.reached;
    await writeFile(target, "export const externalSameInode = true;\n");
    await chmod(target, 0o600);
    expect((await stat(target)).ino).toBe(before.ino);
    barrier.release();
    const error = await applying.then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(await fixture.read("src/value.ts")).toBe("export const externalSameInode = true;\n");
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    expect(classifyPublicError(error)).toMatchObject({ code: "CONFLICT" });
  });

  it("creation race preserves the competitor and reports conflict", async () => {
    const fixture = await createProjectFixture({ "src/existing.ts": "export const ok = true;\n" });
    fixtures.push(fixture);
    const target = path.join(fixture.root, "src/user.service.ts");
    const prepared = await prepareScaffoldClass({
      projectRoot: fixture.root,
      filePath: "src/user.service.ts",
      spec: scaffoldSpec(),
    });
    const barrier = holdFilePhase(
      ({ operationId, phase }) =>
        operationId === prepared.operation.operation_id && phase === "before-publish",
    );
    const applying = applyOperation(prepared.operation.operation_id, prepared.operation.plan_hash);
    await barrier.reached;
    await writeFile(target, "export const externalCreation = true;\n");
    const competitor = await stat(target);
    barrier.release();
    const error = await rejectionOf(applying);

    expect(await readFile(target, "utf8")).toBe("export const externalCreation = true;\n");
    expect((await stat(target)).ino).toBe(competitor.ino);
    expect(classifyPublicError(error)).toMatchObject({ code: "CONFLICT" });
  });

  it("distinct configurations cannot overwrite a shared physical file", async () => {
    const fixture = await createProjectFixture({
      "src/shared.ts": "export function shared(): string { return 'original'; }\n",
    });
    fixtures.push(fixture);
    const config = JSON.stringify({
      compilerOptions: { strict: true },
      include: ["src/shared.ts"],
    });
    await fixture.write("tsconfig.a.json", config);
    await fixture.write("tsconfig.b.json", config);
    const input = { filePath: "src/shared.ts", symbolPath: "shared" };
    const a = await prepareReplaceBody({
      ...input,
      projectRoot: path.join(fixture.root, "tsconfig.a.json"),
      newBody: "return 'A';",
    });
    const b = await prepareReplaceBody({
      ...input,
      projectRoot: path.join(fixture.root, "tsconfig.b.json"),
      newBody: "return 'B';",
    });
    const barrier = holdFilePhase(
      ({ operationId, phase }) => operationId === a.operation_id && phase === "before-publish",
    );
    const applyingA = applyOperation(a.operation_id, a.plan_hash);
    await barrier.reached;
    await applyOperation(b.operation_id, b.plan_hash);
    barrier.release();
    const error = await applyingA.then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(await fixture.read("src/shared.ts")).toContain("return 'B'");
    expect(classifyPublicError(error)).toMatchObject({ code: "CONFLICT" });
  });

  it("multi-file apply preserves a later external target", async () => {
    const fixture = await renameFixture();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    const barrier = holdFilePhase(
      ({ operationId, index, phase }) =>
        operationId === prepared.operation_id && index === 0 && phase === "after-commit",
    );
    const applying = applyOperation(prepared.operation_id, prepared.plan_hash);
    await barrier.reached;
    await fixture.write("src/value.ts", "export const externalLaterTarget = true;\n");
    barrier.release();
    const error = await applying.then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(await fixture.read("src/value.ts")).toBe("export const externalLaterTarget = true;\n");
    expect(classifyPublicError(error)).toMatchObject({ code: "CONFLICT" });
  });

  it("rollback preserves a changed earlier commit and reports ambiguity", async () => {
    const fixture = await renameFixture();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    let rollbackArrived!: () => void;
    const rollbackReached = new Promise<void>((resolve) => (rollbackArrived = resolve));
    let releaseRollback!: () => void;
    const rollbackReleased = new Promise<void>((resolve) => (releaseRollback = resolve));
    setOperationTestHooksForTests({
      onFilePhase: async ({ operationId, index, phase }) => {
        if (operationId !== prepared.operation_id) return;
        if (phase === "before-publish" && index === 1) throw new Error("later conflict");
        if (phase === "before-rollback" && index === 0) {
          rollbackArrived();
          await rollbackReleased;
        }
      },
    });
    const applying = applyOperation(prepared.operation_id, prepared.plan_hash);
    await rollbackReached;
    await fixture.write("src/use.ts", "export const externalRollback = true;\n");
    releaseRollback();
    const error = await rejectionOf(applying);

    expect(await fixture.read("src/use.ts")).toBe("export const externalRollback = true;\n");
    expect(classifyPublicError(error)).toMatchObject({ code: "AMBIGUOUS_APPLY" });
    expect(
      (await readdir(path.join(fixture.root, "src"))).filter((entry) =>
        entry.includes(`.ast-mcp-${prepared.operation_id}-`),
      ),
    ).toHaveLength(2);
  });

  it("unsupported publication capability has zero source effects and is mutation blocked", async () => {
    const { fixture, prepared } = await oneFileReplacement();
    const original = await fixture.read("src/value.ts");
    let arrive!: () => void;
    const reached = new Promise<void>((resolve) => (arrive = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    setOperationTestHooksForTests({
      onFilePhase: async (event) => {
        if (event.operationId !== prepared.operation_id || event.phase !== "capability-preflight")
          return;
        arrive();
        await released;
        throw new Error("publication capability unsupported");
      },
    });
    const applying = applyOperation(prepared.operation_id, prepared.plan_hash);
    await reached;
    release();
    const error = await rejectionOf(applying);

    expect(await fixture.read("src/value.ts")).toBe(original);
    expect(classifyPublicError(error)).toMatchObject({ code: "MUTATION_BLOCKED" });
  });

  it("rejects a stale plan before writing any files", async () => {
    const fixture = await renameFixture();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    const originalUse = await fixture.read("src/use.ts");
    await fixture.write(
      "src/value.ts",
      `export function formatValue(value: number): string { return \`external:\${value}\`; }\n`,
    );

    const failure = await rejectionOf(applyOperation(prepared.operation_id, prepared.plan_hash));
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/workspace changed/);
    expect(classifyPublicError(failure)).toEqual({
      code: "CONFLICT",
      message: "The operation conflicts with current state.",
    });
    expect(await fixture.read("src/use.ts")).toBe(originalUse);
    expect(await fixture.read("src/value.ts")).toContain("external:");
  });

  it("invalidates a plan when any project source changes", async () => {
    const fixture = await renameFixture();
    await fixture.write("src/unrelated.ts", "export const unrelated = 1;\n");
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    await fixture.write("src/unrelated.ts", "export const unrelated = 2;\n");

    await expect(applyOperation(prepared.operation_id, prepared.plan_hash)).rejects.toThrow(
      /workspace changed/,
    );
    expect(await fixture.read("src/value.ts")).toContain("formatValue");
  });

  it("requires the exact reviewed plan hash", async () => {
    const fixture = await renameFixture();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });

    await expect(applyOperation(prepared.operation_id, "0".repeat(64))).rejects.toThrow(
      /Plan hash mismatch/,
    );
    expect(await fixture.read("src/value.ts")).toContain("formatValue");
  });

  it("rolls back already replaced files after an injected mid-apply failure", async () => {
    const fixture = await renameFixture();
    const originalValue = await fixture.read("src/value.ts");
    const originalUse = await fixture.read("src/use.ts");
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    setOperationTestHooksForTests({
      onFilePhase: ({ index, phase }) => {
        if (phase === "before-publish" && index === 1) throw new Error("injected failure");
      },
    });

    await expect(applyOperation(prepared.operation_id, prepared.plan_hash)).rejects.toThrow(
      /rollback succeeded/,
    );
    expect(await fixture.read("src/value.ts")).toBe(originalValue);
    expect(await fixture.read("src/use.ts")).toBe(originalUse);
  });

  it("serializes concurrent apply retries and returns an idempotent receipt", async () => {
    const fixture = await renameFixture();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });

    const results = await Promise.all([
      applyOperation(prepared.operation_id, prepared.plan_hash),
      applyOperation(prepared.operation_id, prepared.plan_hash),
    ]);
    expect(results.map((result) => result.idempotent_replay).sort()).toEqual([false, true]);
  });

  it("releases a cancelled cross-session write-lock waiter for later retries", async () => {
    const fixture = await renameFixture();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    let releaseFirstReplace!: () => void;
    const firstReplaceBlocked = new Promise<void>((resolve) => {
      releaseFirstReplace = resolve;
    });
    let firstReplaceStarted!: () => void;
    const firstReplaceReached = new Promise<void>((resolve) => {
      firstReplaceStarted = resolve;
    });
    let secondLockEnqueued!: () => void;
    const secondLockReached = new Promise<void>((resolve) => {
      secondLockEnqueued = resolve;
    });
    let lockEnqueues = 0;
    setOperationTestHooksForTests({
      afterWriteLockEnqueue: () => {
        lockEnqueues += 1;
        if (lockEnqueues === 2) secondLockEnqueued();
      },
      onFilePhase: async ({ index, phase }) => {
        if (phase !== "before-publish" || index !== 0 || lockEnqueues !== 1) return;
        firstReplaceStarted();
        await firstReplaceBlocked;
      },
    });

    const first = applyOperation(prepared.operation_id, prepared.plan_hash);
    await firstReplaceReached;
    invalidateProject(fixture.root);

    const controller = new AbortController();
    const second = applyOperation(
      prepared.operation_id,
      prepared.plan_hash,
      createRequestContext(controller.signal),
    );
    const secondExpectation = expect(second).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    await secondLockReached;
    controller.abort();
    const third = applyOperation(prepared.operation_id, prepared.plan_hash);

    releaseFirstReplace();
    await expect(first).resolves.toMatchObject({ status: "applied", idempotent_replay: false });
    await secondExpectation;
    await expect(third).resolves.toMatchObject({ status: "applied", idempotent_replay: true });
  });

  it("expires prepared operations using the operation clock", async () => {
    const fixture = await renameFixture();
    let now = 1_000;
    setOperationStoreConfigForTests({ now: () => now, ttlMs: 50 });
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    now += 51;

    const failure = await rejectionOf(applyOperation(prepared.operation_id, prepared.plan_hash));
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/expired/);
    expect(classifyPublicError(failure)).toEqual({
      code: "NOT_FOUND",
      message: "The requested target was not found.",
    });
  });

  it("evicts the oldest plan when the bounded store reaches capacity", async () => {
    const fixture = await renameFixture();
    setOperationStoreConfigForTests({ maxOperations: 2 });
    const plans: Awaited<ReturnType<typeof prepareRename>>[] = [];
    for (const newName of ["renderValue", "printValue", "showValue"]) {
      plans.push(
        await prepareRename({
          projectRoot: fixture.root,
          filePath: "src/value.ts",
          symbolPath: "formatValue",
          newName,
        }),
      );
    }

    await expect(getOperationPreview(plans[0]!.operation_id)).rejects.toThrow(
      /not found or has expired/,
    );
    expect((await getOperationPreview(plans[1]!.operation_id)).plan_hash).toBe(plans[1]!.plan_hash);
    expect((await getOperationPreview(plans[2]!.operation_id)).plan_hash).toBe(plans[2]!.plan_hash);
  });

  it("blocks a replacement that introduces a new TypeScript error", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": `export function value(): number { return 1; }\n`,
    });
    fixtures.push(fixture);
    const prepared = await prepareReplaceBody({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "value",
      newBody: `return "wrong";`,
    });

    expect(prepared.blocked).toBe(true);
    expect(prepared.diagnostics.addedErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 2322 })]),
    );
    const failure = await rejectionOf(applyOperation(prepared.operation_id, prepared.plan_hash));
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/new TypeScript error/);
    expect(classifyPublicError(failure)).toEqual({
      code: "MUTATION_BLOCKED",
      message: "The mutation is blocked.",
    });
    expect(await fixture.read("src/value.ts")).toContain("return 1");
  });

  it("replaces arrow-function bodies without changing their signature", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": `export const double = (value: number): number => value * 2;\n`,
    });
    fixtures.push(fixture);
    const prepared = await prepareReplaceBody({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "double",
      newBody: "return value * 3;",
    });
    expect(prepared.blocked).toBe(false);
    await applyOperation(prepared.operation_id, prepared.plan_hash);
    const text = await fixture.read("src/value.ts");
    expect(text).toContain("(value: number): number");
    expect(text).toContain("return value * 3;");
  });

  it("preserves a UTF-8 BOM when applying a replacement", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export function value(): number { return 1; }\n",
    });
    fixtures.push(fixture);
    const absolutePath = path.join(fixture.root, "src/value.ts");
    const source = Buffer.from(await fixture.read("src/value.ts"), "utf8");
    await writeFile(absolutePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), source]));

    const prepared = await prepareReplaceBody({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "value",
      newBody: "return 2;",
    });
    await applyOperation(prepared.operation_id, prepared.plan_hash);

    const bytes = await readFile(absolutePath);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toContain("return 2;");
  });

  it("recovers an applied operation from exact postimages after receipt persistence fails", async () => {
    const fixture = await renameFixture();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    const persistedBeforeApply = exportOperationRecord(prepared.operation_id);
    configureOperationApply(prepared.operation_id, {
      receiptWriter: async () => {
        throw new Error("injected receipt failure");
      },
    });

    await expect(applyOperation(prepared.operation_id, prepared.plan_hash)).rejects.toThrow(
      /postimages.*receipt persistence failed/i,
    );
    expect(await fixture.read("src/value.ts")).toContain("renderValue");

    clearOperationsForTests();
    importOperationRecord(persistedBeforeApply, prepared.plan_hash);
    let receiptPersisted = false;
    configureOperationApply(prepared.operation_id, {
      receiptWriter: async () => {
        receiptPersisted = true;
      },
    });

    const recovered = await applyOperation(prepared.operation_id, prepared.plan_hash);
    expect(recovered.idempotent_replay).toBe(true);
    expect(receiptPersisted).toBe(true);
  });

  it("prepares a class scaffold without writing and creates it idempotently on apply", async () => {
    const fixture = await createProjectFixture({
      "src/existing.ts": "export const existing = true;\n",
    });
    fixtures.push(fixture);
    const target = path.join(fixture.root, "src/user.service.ts");
    const prepared = await prepareScaffoldClass({
      projectRoot: fixture.root,
      filePath: "src/user.service.ts",
      spec: scaffoldSpec(),
    });

    expect(prepared.operation.kind).toBe("scaffold_class");
    expect(prepared.operation.blocked).toBe(false);
    expect(prepared.pendingMethods).toEqual(["UserService.findUser"]);
    expect(prepared.outline).toContain("findUser(id: string): Promise<string>;");
    expect((await getOperationPreview(prepared.operation.operation_id)).files[0]?.diff).toContain(
      "/dev/null",
    );
    await expect(access(target)).rejects.toThrow();

    const applied = await applyOperation(
      prepared.operation.operation_id,
      prepared.operation.plan_hash,
    );
    expect(applied.idempotent_replay).toBe(false);
    expect(await readFile(target, "utf8")).toContain("Not implemented: UserService.findUser");
    const replay = await applyOperation(
      prepared.operation.operation_id,
      prepared.operation.plan_hash,
    );
    expect(replay.idempotent_replay).toBe(true);
  });

  it("never clobbers a scaffold target created after preparation", async () => {
    const fixture = await createProjectFixture({
      "src/existing.ts": "export const existing = true;\n",
    });
    fixtures.push(fixture);
    const target = path.join(fixture.root, "src/user.service.ts");
    const prepared = await prepareScaffoldClass({
      projectRoot: fixture.root,
      filePath: "src/user.service.ts",
      spec: scaffoldSpec(),
    });
    await writeFile(target, "export const external = true;\n");

    await expect(
      applyOperation(prepared.operation.operation_id, prepared.operation.plan_hash),
    ).rejects.toThrow(/exists|changed/i);
    expect(await readFile(target, "utf8")).toBe("export const external = true;\n");
  });

  it("distinguishes an existing empty target from absence and rejects symbolic parents", async () => {
    const fixture = await createProjectFixture({
      "src/existing.ts": "export const existing = true;\n",
    });
    fixtures.push(fixture);
    const emptyTarget = path.join(fixture.root, "src/empty.ts");
    await writeFile(emptyTarget, "");

    await expect(
      prepareScaffoldClass({
        projectRoot: fixture.root,
        filePath: "src/empty.ts",
        spec: scaffoldSpec(),
      }),
    ).rejects.toThrow(/already exists/i);
    expect(await readFile(emptyTarget, "utf8")).toBe("");

    if (process.platform !== "win32") {
      const linkedParent = path.join(fixture.root, "linked-src");
      await symlink(path.join(fixture.root, "src"), linkedParent, "dir");
      await expect(
        prepareScaffoldClass({
          projectRoot: fixture.root,
          filePath: "linked-src/user.service.ts",
          spec: scaffoldSpec(),
        }),
      ).rejects.toThrow(/symbolic link/i);
    }
  });

  it("blocks new scaffold diagnostics unless explicitly allowed", async () => {
    const fixture = await createProjectFixture({
      "src/existing.ts": "export const existing = true;\n",
    });
    fixtures.push(fixture);
    const invalidSpec = {
      ...scaffoldSpec(),
      methods: [
        {
          name: "findUser",
          isAsync: false,
          params: [],
          returnType: "MissingType",
        },
      ],
    };

    const blocked = await prepareScaffoldClass({
      projectRoot: fixture.root,
      filePath: "src/blocked.service.ts",
      spec: invalidSpec,
    });
    expect(blocked.operation.blocked).toBe(true);
    expect(blocked.operation.diagnostics.addedErrors.length).toBeGreaterThan(0);
    await expect(
      applyOperation(blocked.operation.operation_id, blocked.operation.plan_hash),
    ).rejects.toThrow(/new TypeScript error/i);
    await expect(access(path.join(fixture.root, "src/blocked.service.ts"))).rejects.toThrow();

    const allowed = await prepareScaffoldClass({
      projectRoot: fixture.root,
      filePath: "src/allowed.service.ts",
      spec: invalidSpec,
      allowNewErrors: true,
    });
    expect(allowed.operation.blocked).toBe(false);
    expect(allowed.operation.allow_new_errors).toBe(true);
    expect(allowed.operation.diagnostics.addedErrors.length).toBeGreaterThan(0);
    await applyOperation(allowed.operation.operation_id, allowed.operation.plan_hash);
    expect(await readFile(path.join(fixture.root, "src/allowed.service.ts"), "utf8")).toContain(
      "MissingType",
    );
  });

  it("preserves a created destination and hidden stage when rollback is ambiguous", async () => {
    const fixture = await createProjectFixture({
      "src/existing.ts": "export const existing = true;\n",
    });
    fixtures.push(fixture);
    const target = path.join(fixture.root, "src/user.service.ts");
    const prepared = await prepareScaffoldClass({
      projectRoot: fixture.root,
      filePath: "src/user.service.ts",
      spec: scaffoldSpec(),
    });
    setOperationTestHooksForTests({
      onFilePhase: ({ phase }) => {
        if (phase === "after-commit") throw new Error("injected post-create failure");
      },
    });

    const error = await rejectionOf(
      applyOperation(prepared.operation.operation_id, prepared.operation.plan_hash),
    );
    expect(classifyPublicError(error)).toMatchObject({ code: "AMBIGUOUS_APPLY" });
    expect(await readFile(target, "utf8")).toContain("class UserService");
    expect(
      (await readdir(path.dirname(target))).filter((entry) =>
        entry.includes(`.ast-mcp-${prepared.operation.operation_id}-`),
      ),
    ).toHaveLength(1);
  });

  it("preserves a scaffold target changed before rollback can verify its postimage", async () => {
    const fixture = await createProjectFixture({
      "src/existing.ts": "export const existing = true;\n",
    });
    fixtures.push(fixture);
    const target = path.join(fixture.root, "src/user.service.ts");
    const prepared = await prepareScaffoldClass({
      projectRoot: fixture.root,
      filePath: "src/user.service.ts",
      spec: scaffoldSpec(),
    });
    setOperationTestHooksForTests({
      onFilePhase: async ({ phase }) => {
        if (phase !== "after-commit") return;
        await writeFile(target, "export const competingWriter = true;\n");
        throw new Error("injected post-create failure");
      },
    });

    const error = await rejectionOf(
      applyOperation(prepared.operation.operation_id, prepared.operation.plan_hash),
    );
    expect(classifyPublicError(error)).toMatchObject({ code: "AMBIGUOUS_APPLY" });
    expect(await readFile(target, "utf8")).toBe("export const competingWriter = true;\n");
    expect(
      (await readdir(path.dirname(target))).filter((entry) =>
        entry.includes(`.ast-mcp-${prepared.operation.operation_id}-`),
      ),
    ).toHaveLength(1);
  });

  it("recovers a durable scaffold postimage after receipt persistence fails", async () => {
    const fixture = await createProjectFixture({
      "src/existing.ts": "export const existing = true;\n",
    });
    fixtures.push(fixture);
    const target = path.join(fixture.root, "src/user.service.ts");
    const prepared = await prepareScaffoldClass({
      projectRoot: fixture.root,
      filePath: "src/user.service.ts",
      spec: scaffoldSpec(),
    });
    const persisted = exportOperationRecord(prepared.operation.operation_id);
    configureOperationApply(prepared.operation.operation_id, {
      receiptWriter: async () => {
        throw new Error("injected receipt failure");
      },
    });

    await expect(
      applyOperation(prepared.operation.operation_id, prepared.operation.plan_hash),
    ).rejects.toThrow(/postimages.*receipt persistence failed/i);
    expect(await readFile(target, "utf8")).toContain("Not implemented: UserService.findUser");

    clearOperationsForTests();
    importOperationRecord(persisted, prepared.operation.plan_hash);
    let receiptPersisted = false;
    configureOperationApply(prepared.operation.operation_id, {
      receiptWriter: async () => {
        receiptPersisted = true;
      },
    });
    const recovered = await applyOperation(
      prepared.operation.operation_id,
      prepared.operation.plan_hash,
    );
    expect(recovered.idempotent_replay).toBe(true);
    expect(receiptPersisted).toBe(true);
  });

  it.runIf(process.platform !== "win32")(
    "rejects a persisted operation whose target was replaced by a symbolic link",
    async () => {
      const fixture = await renameFixture();
      const prepared = await prepareRename({
        projectRoot: fixture.root,
        filePath: "src/value.ts",
        symbolPath: "formatValue",
        newName: "renderValue",
      });
      const persisted = exportOperationRecord(prepared.operation_id);
      const target = path.join(fixture.root, "src/value.ts");
      const external = path.join(
        path.dirname(fixture.root),
        `${path.basename(fixture.root)}-external.ts`,
      );
      await writeFile(external, await readFile(target));
      await unlink(target);
      await symlink(external, target);
      clearOperationsForTests();

      expect(() => importOperationRecord(persisted, prepared.plan_hash)).toThrow(/symbolic link/i);
    },
  );
});
