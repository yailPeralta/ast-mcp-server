import { createHash } from "node:crypto";
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
import type { TemplateDiagnostics } from "../src/services/angular-template-typecheck.js";
import {
  applyOperation,
  clearOperationsForTests,
  importOperationRecord,
  prepareRename,
  prepareScaffoldClass,
  setOperationStoreConfigForTests,
  type PersistedOperationRecord,
} from "../src/services/operations.js";
import { clearProjectSessions } from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];
const stateDirectories: string[] = [];

type PlanEnvelope = { schema_version: 1 | 2 | 3; operation: PersistedOperationRecord };

function planHashFor(operation: PersistedOperationRecord, version: 1 | 2 | 3): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version,
        operation_id: operation.operation_id,
        kind: operation.kind,
        project_root: operation.project_root,
        created_at: operation.created_at,
        expires_at: operation.expires_at,
        reference_count: operation.reference_count,
        workspace_hash: operation.workspace_hash,
        post_workspace_hash: operation.post_workspace_hash,
        workspace_file_count: operation.workspace_file_count,
        diagnostics: operation.diagnostics,
        allow_new_errors: operation.allow_new_errors,
        blocked: operation.blocked,
        ...(version === 3
          ? {
              template_diagnostics: {
                status: operation.template_diagnostics?.status,
                ...(operation.template_diagnostics?.status === "completed"
                  ? {}
                  : { reason: (operation.template_diagnostics as { reason?: string }).reason }),
                added: operation.template_diagnostics?.added,
                removed: operation.template_diagnostics?.removed,
                addedErrors: operation.template_diagnostics?.addedErrors,
              },
              block_on_template_errors: operation.block_on_template_errors,
            }
          : {}),
        files: operation.files.map((file) => ({
          file: file.file,
          original_hash: file.original_hash,
          updated_hash: file.updated_hash,
          mode: file.mode,
        })),
      }),
    )
    .digest("hex");
}

async function rewritePlanVersion(planFile: string, version: 1 | 2 | 3): Promise<PlanEnvelope> {
  const envelope = JSON.parse(await readFile(planFile, "utf8")) as PlanEnvelope;
  envelope.schema_version = version;
  envelope.operation.plan_hash = planHashFor(envelope.operation, version);
  await writeFile(planFile, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
  await chmod(planFile, 0o600);
  return envelope;
}

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
    const preparedEnvelope = JSON.parse(await readFile(planFile, "utf8")) as PlanEnvelope;

    expect((await stat(planFile)).mode & 0o777).toBe(0o600);
    expect(Object.keys(preparedEnvelope).sort()).toEqual(["operation", "schema_version"]);
    expect(preparedEnvelope.schema_version).toBe(2);
    expect(prepared.plan_hash).toBe(planHashFor(preparedEnvelope.operation, 2));
    expect(prepared.plan_hash).not.toBe(planHashFor(preparedEnvelope.operation, 1));
    expect((await inspectPersistedPlan(planFile)).schema_version).toBe(2);
    clearOperationsForTests();
    const applied = await applyPersistedOperation(planFile, prepared.plan_hash, { stateDirectory });

    expect(applied.idempotent_replay).toBe(false);
    expect(await readFile(path.join(fixture.root, "src/value.ts"), "utf8")).toContain(
      "renderValue",
    );
    expect(await readFile(path.join(fixture.root, "src/use.ts"), "utf8")).toContain("renderValue");
    expect((JSON.parse(await readFile(planFile, "utf8")) as PlanEnvelope).schema_version).toBe(2);

    clearOperationsForTests();
    setOperationStoreConfigForTests({ now: () => Date.now() + 24 * 60 * 60 * 1000 });
    const replay = await applyPersistedOperation(planFile, prepared.plan_hash, { stateDirectory });
    expect(replay.idempotent_replay).toBe(true);
    expect(await inspectPersistedPlan(planFile)).toMatchObject({
      schema_version: 2,
      status: "applied",
    });
  });

  it("rejects a syntactically valid legacy prepared plan before import or writes", async () => {
    const { fixture, stateDirectory } = await setup();
    const source = path.join(fixture.root, "src/value.ts");
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    const planFile = await persistOperationPlan(prepared.operation_id, { stateDirectory });
    const legacy = await rewritePlanVersion(planFile, 1);
    clearOperationsForTests();

    await expect(
      applyPersistedOperation(planFile, legacy.operation.plan_hash, { stateDirectory }),
    ).rejects.toThrow(/legacy.*prepared/i);
    expect(await readFile(source, "utf8")).toContain("formatValue");
    await expect(applyOperation(prepared.operation_id, legacy.operation.plan_hash)).rejects.toThrow(
      /not found/i,
    );
  });

  it("replays only exact legacy applied postimages without upgrading the receipt", async () => {
    const { fixture, stateDirectory } = await setup();
    const source = path.join(fixture.root, "src/value.ts");
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    const planFile = await persistOperationPlan(prepared.operation_id, { stateDirectory });
    await applyPersistedOperation(planFile, prepared.plan_hash, { stateDirectory });
    const legacy = await rewritePlanVersion(planFile, 1);
    clearOperationsForTests();

    await expect(
      applyPersistedOperation(planFile, legacy.operation.plan_hash, { stateDirectory }),
    ).resolves.toMatchObject({ idempotent_replay: true });
    expect(await inspectPersistedPlan(planFile)).toMatchObject({
      schema_version: 1,
      status: "applied",
    });

    await writeFile(source, "export const mismatched = true;\n");
    clearOperationsForTests();
    await expect(
      applyPersistedOperation(planFile, legacy.operation.plan_hash, { stateDirectory }),
    ).rejects.toThrow(/postimage/i);
    expect(await readFile(source, "utf8")).toBe("export const mismatched = true;\n");
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
      schema_version: number;
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

    (envelope as { schema_version: number }).schema_version = 4;
    await writeFile(planFile, JSON.stringify(envelope), { mode: 0o600 });
    await expect(inspectPersistedPlan(planFile)).rejects.toThrow(/schema_version|discriminator/i);
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

describe("version 3 plans that carry a template check", () => {
  const templateError = {
    code: 2339,
    category: "Error",
    file: "src/use.html",
    line: 1,
    column: 3,
    message: "Property 'x' does not exist.",
  };
  const completed: TemplateDiagnostics = {
    status: "completed",
    added: [templateError],
    removed: [],
    addedErrors: [templateError],
  };
  const unfinished: TemplateDiagnostics = {
    status: "unfinished",
    reason: "deadline",
    added: [],
    removed: [],
    addedErrors: [],
  };

  /** Turns a prepared TypeScript-only plan into the plan a template check would have produced. */
  async function preparedV3(
    template: TemplateDiagnostics,
    blockOnTemplateErrors = false,
  ): Promise<{ fixture: ProjectFixture; stateDirectory: string; planFile: string; hash: string }> {
    const { fixture, stateDirectory } = await setup();
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    const planFile = await persistOperationPlan(prepared.operation_id, { stateDirectory });
    const envelope = JSON.parse(await readFile(planFile, "utf8")) as PlanEnvelope;
    envelope.schema_version = 3;
    envelope.operation.template_diagnostics = template;
    envelope.operation.block_on_template_errors = blockOnTemplateErrors;
    envelope.operation.blocked = blockOnTemplateErrors && template.addedErrors.length > 0;
    envelope.operation.block_reason = envelope.operation.blocked
      ? "1 new template error(s) would be introduced. Prepare again with allow_new_errors=true only after explicit review."
      : null;
    envelope.operation.plan_hash = planHashFor(envelope.operation, 3);
    await writeFile(planFile, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
    await chmod(planFile, 0o600);
    clearOperationsForTests();
    return { fixture, stateDirectory, planFile, hash: envelope.operation.plan_hash };
  }

  it("round-trips a v3 plan through persist, import, apply and receipt", async () => {
    const { fixture, stateDirectory, planFile, hash } = await preparedV3(completed);

    expect(await inspectPersistedPlan(planFile)).toMatchObject({ schema_version: 3 });
    const applied = await applyPersistedOperation(planFile, hash, { stateDirectory });

    expect(applied.idempotent_replay).toBe(false);
    expect(await readFile(path.join(fixture.root, "src/value.ts"), "utf8")).toContain(
      "renderValue",
    );
    const receipt = JSON.parse(await readFile(planFile, "utf8")) as PlanEnvelope;
    expect(receipt.schema_version).toBe(3);
    expect(receipt.operation.template_diagnostics).toEqual(completed);
    expect(receipt.operation.status).toBe("applied");
  });

  it("writes schema version 3 only for a plan that carries the check", async () => {
    const { planFile, stateDirectory, hash } = await preparedV3(unfinished, true);
    const record = (JSON.parse(await readFile(planFile, "utf8")) as PlanEnvelope).operation;

    importOperationRecord(record, hash, 3);
    const rewritten = await persistOperationPlan(record.operation_id, { stateDirectory });
    const envelope = JSON.parse(await readFile(rewritten, "utf8")) as PlanEnvelope;

    expect(envelope.schema_version).toBe(3);
    expect(envelope.operation.block_on_template_errors).toBe(true);
    expect(envelope.operation.template_diagnostics).toEqual(unfinished);
  });

  it("rejects a v3 plan whose template delta was tampered with", async () => {
    const { planFile, stateDirectory, hash } = await preparedV3(completed);
    const envelope = JSON.parse(await readFile(planFile, "utf8")) as PlanEnvelope;
    envelope.operation.template_diagnostics = unfinished;
    await writeFile(planFile, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
    await chmod(planFile, 0o600);

    await expect(applyPersistedOperation(planFile, hash, { stateDirectory })).rejects.toThrow(
      /integrity mismatch/i,
    );
  });

  it("rejects malformed v3 template records with the strict schema", async () => {
    const { planFile } = await preparedV3(completed);
    const base = JSON.parse(await readFile(planFile, "utf8")) as PlanEnvelope;
    await expect(inspectPersistedPlan(planFile)).resolves.toMatchObject({ schema_version: 3 });
    const variants: Record<string, (operation: Record<string, unknown>) => void> = {
      "an unknown key": (operation) => {
        (operation.template_diagnostics as Record<string, unknown>).extra = true;
      },
      "a reason on a completed check": (operation) => {
        (operation.template_diagnostics as Record<string, unknown>).reason = "deadline";
      },
      "a non-completed check with diagnostics": (operation) => {
        operation.template_diagnostics = { ...unfinished, added: [templateError] };
      },
      "a non-completed check without a reason": (operation) => {
        operation.template_diagnostics = {
          status: "unfinished",
          added: [],
          removed: [],
          addedErrors: [],
        };
      },
      "a missing block_on_template_errors": (operation) => {
        delete operation.block_on_template_errors;
      },
      "a missing template_diagnostics": (operation) => {
        delete operation.template_diagnostics;
      },
    };
    for (const [name, mutate] of Object.entries(variants)) {
      const envelope = structuredClone(base);
      mutate(envelope.operation as unknown as Record<string, unknown>);
      await writeFile(planFile, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
      await chmod(planFile, 0o600);
      await expect(inspectPersistedPlan(planFile), name).rejects.toThrow();
    }
  });

  it("keeps v1 and v2 strict: neither accepts template fields", async () => {
    const { planFile } = await preparedV3(completed);
    for (const version of [1, 2] as const) {
      const envelope = JSON.parse(await readFile(planFile, "utf8")) as PlanEnvelope;
      envelope.schema_version = version;
      await writeFile(planFile, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
      await chmod(planFile, 0o600);
      await expect(inspectPersistedPlan(planFile), `v${version}`).rejects.toThrow();
    }
  });
});
