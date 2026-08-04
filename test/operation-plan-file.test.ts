import {
  chmod,
  link,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPersistedOperation,
  inspectPersistedPlan,
  persistOperationPlan,
} from "../src/services/operation-plan-file.js";
import {
  clearOperationsForTests,
  prepareRename,
  prepareScaffoldClass,
  setOperationStoreConfigForTests,
} from "../src/services/operations.js";
import { clearProjectSessions } from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];
const stateDirectories: string[] = [];

async function setup(): Promise<{ fixture: ProjectFixture; stateDirectory: string }> {
  const fixture = await createProjectFixture({
    "src/value.ts":
      "export function formatValue(value: number): string { return String(value); }\n",
    "src/use.ts":
      'import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n',
  });
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "ast-tool-state-"));
  fixtures.push(fixture);
  stateDirectories.push(stateDirectory);
  return { fixture, stateDirectory };
}

afterEach(async () => {
  clearOperationsForTests();
  clearProjectSessions();
  await Promise.all([
    ...fixtures.splice(0).map((fixture) => fixture.cleanup()),
    ...stateDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  ]);
});

describe("persisted operation plans", () => {
  it("prepares and applies across separate operation stores, then replays the receipt", async () => {
    const { fixture, stateDirectory } = await setup();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    const planFile = await persistOperationPlan(prepared.operation_id, { stateDirectory });

    expect((await stat(planFile)).mode & 0o777).toBe(0o600);
    clearOperationsForTests();
    const applied = await applyPersistedOperation(planFile, prepared.plan_hash, { stateDirectory });

    expect(applied.idempotent_replay).toBe(false);
    expect(await readFile(path.join(fixture.root, "src/value.ts"), "utf8")).toContain(
      "renderValue",
    );
    expect(await readFile(path.join(fixture.root, "src/use.ts"), "utf8")).toContain("renderValue");

    clearOperationsForTests();
    setOperationStoreConfigForTests({ now: () => Date.now() + 24 * 60 * 60 * 1000 });
    const replay = await applyPersistedOperation(planFile, prepared.plan_hash, { stateDirectory });
    expect(replay.idempotent_replay).toBe(true);
    expect((await inspectPersistedPlan(planFile)).status).toBe("applied");
  });

  it("persists, creates and idempotently replays a class scaffold across stores", async () => {
    const { fixture, stateDirectory } = await setup();
    const target = path.join(fixture.root, "src/value-service.ts");
    const prepared = await prepareScaffoldClass({
      projectRoot: fixture.root,
      filePath: "src/value-service.ts",
      spec: {
        className: "ValueService",
        imports: [],
        implements: [],
        decorators: [],
        constructorParams: [],
        properties: [],
        methods: [
          {
            name: "render",
            isAsync: false,
            returnType: "string",
            params: [{ name: "value", type: "number" }],
          },
        ],
      },
    });
    const planFile = await persistOperationPlan(prepared.operation.operation_id, {
      stateDirectory,
    });
    await expect(readFile(target, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    clearOperationsForTests();
    const applied = await applyPersistedOperation(planFile, prepared.operation.plan_hash, {
      stateDirectory,
    });
    expect(applied).toMatchObject({ kind: "scaffold_class", idempotent_replay: false });
    expect(await readFile(target, "utf8")).toContain(
      'throw new Error("Not implemented: ValueService.render")',
    );

    clearOperationsForTests();
    setOperationStoreConfigForTests({ now: () => Date.now() + 24 * 60 * 60 * 1000 });
    const replay = await applyPersistedOperation(planFile, prepared.operation.plan_hash, {
      stateDirectory,
    });
    expect(replay).toMatchObject({ kind: "scaffold_class", idempotent_replay: true });
    expect((await inspectPersistedPlan(planFile)).status).toBe("applied");
  });

  it("rejects a wrong reviewed hash and corrupted bytes without writing", async () => {
    const { fixture, stateDirectory } = await setup();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    const planFile = await persistOperationPlan(prepared.operation_id, { stateDirectory });
    clearOperationsForTests();

    await expect(
      applyPersistedOperation(planFile, "0".repeat(64), { stateDirectory }),
    ).rejects.toThrow(/hash mismatch/i);
    expect(await readFile(path.join(fixture.root, "src/value.ts"), "utf8")).toContain(
      "formatValue",
    );

    const envelope = JSON.parse(await readFile(planFile, "utf8")) as {
      operation: { files: Array<{ updated_bytes_base64: string }> };
    };
    envelope.operation.files[0]!.updated_bytes_base64 = Buffer.from("tampered").toString("base64");
    await writeFile(planFile, JSON.stringify(envelope), { mode: 0o600 });
    await chmod(planFile, 0o600);

    await expect(
      applyPersistedOperation(planFile, prepared.plan_hash, { stateDirectory }),
    ).rejects.toThrow(/updated hash mismatch/i);
    expect(await readFile(path.join(fixture.root, "src/value.ts"), "utf8")).toContain(
      "formatValue",
    );
  });

  it("rejects expired and overly permissive plan artifacts", async () => {
    const { fixture, stateDirectory } = await setup();
    setOperationStoreConfigForTests({ now: () => 1, ttlMs: 1 });
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    const planFile = await persistOperationPlan(prepared.operation_id, { stateDirectory });
    clearOperationsForTests();

    await expect(
      applyPersistedOperation(planFile, prepared.plan_hash, { stateDirectory }),
    ).rejects.toThrow(/expired/i);

    await chmod(planFile, 0o644);
    await expect(inspectPersistedPlan(planFile)).rejects.toThrow(/permissions/i);
  });

  it.runIf(process.platform !== "win32")(
    "rejects hard-linked plans and plan paths traversing a symbolic directory",
    async () => {
      const { fixture, stateDirectory } = await setup();
      const prepared = await prepareRename({
        projectRoot: fixture.root,
        filePath: "src/value.ts",
        symbolPath: "formatValue",
        newName: "renderValue",
      });
      const planFile = await persistOperationPlan(prepared.operation_id, { stateDirectory });

      const hardLink = path.join(stateDirectory, "hard-linked.astplan");
      await link(planFile, hardLink);
      await expect(inspectPersistedPlan(hardLink)).rejects.toThrow(/hard link/i);
      await unlink(hardLink);

      const stateAlias = path.join(fixture.root, "state-alias");
      await symlink(stateDirectory, stateAlias, "dir");
      const aliasedPlan = path.join(stateAlias, "plans", path.basename(planFile));
      await expect(inspectPersistedPlan(aliasedPlan)).rejects.toThrow(/symbolic links/i);
    },
  );
});
