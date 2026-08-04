import { access, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
import { clearProjectSessions } from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

afterEach(async () => {
  clearOperationsForTests();
  clearProjectSessions();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

async function renameFixture(): Promise<ProjectFixture> {
  const fixture = await createProjectFixture({
    "src/value.ts": `export function formatValue(value: number): string { return String(value); }\n`,
    "src/use.ts": `import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n`,
  });
  fixtures.push(fixture);
  return fixture;
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

    const applied = await applyOperation(prepared.operation_id, prepared.plan_hash);
    expect(applied.idempotent_replay).toBe(false);
    expect(await fixture.read("src/value.ts")).toContain("renderValue");
    expect(await fixture.read("src/use.ts")).toContain("renderValue");

    const replay = await applyOperation(prepared.operation_id, prepared.plan_hash);
    expect(replay.idempotent_replay).toBe(true);
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

    await expect(applyOperation(prepared.operation_id, prepared.plan_hash)).rejects.toThrow(
      /workspace changed/,
    );
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
      beforeReplace: (_file, index) => {
        if (index === 1) throw new Error("injected failure");
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

    await expect(applyOperation(prepared.operation_id, prepared.plan_hash)).rejects.toThrow(
      /expired/,
    );
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

    expect(() => getOperationPreview(plans[0]!.operation_id)).toThrow(/not found or has expired/);
    expect(getOperationPreview(plans[1]!.operation_id).plan_hash).toBe(plans[1]!.plan_hash);
    expect(getOperationPreview(plans[2]!.operation_id).plan_hash).toBe(plans[2]!.plan_hash);
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
    await expect(applyOperation(prepared.operation_id, prepared.plan_hash)).rejects.toThrow(
      /new TypeScript error/,
    );
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
    expect(getOperationPreview(prepared.operation.operation_id).files[0]?.diff).toContain(
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

  it("removes only the exact created postimage after an injected failure", async () => {
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
      afterReplace: () => {
        throw new Error("injected post-create failure");
      },
    });

    await expect(
      applyOperation(prepared.operation.operation_id, prepared.operation.plan_hash),
    ).rejects.toThrow(/rollback succeeded/i);
    await expect(access(target)).rejects.toThrow();
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
      afterReplace: async () => {
        await writeFile(target, "export const competingWriter = true;\n");
        throw new Error("injected post-create failure");
      },
    });

    await expect(
      applyOperation(prepared.operation.operation_id, prepared.operation.plan_hash),
    ).rejects.toThrow(/rollback was incomplete.*postimage/i);
    expect(await readFile(target, "utf8")).toBe("export const competingWriter = true;\n");
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
