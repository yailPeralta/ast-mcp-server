import { readFile, symlink, unlink, writeFile } from "node:fs/promises";
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
