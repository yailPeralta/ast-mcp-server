import { fork, type ChildProcess, type ForkOptions } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkBudgetMs,
  checkTemplateTypes,
  type TemplateDiagnostics,
  type TemplateTypeCheckContext,
  type TemplateTypeCheckInput,
} from "../src/services/angular-template-typecheck.js";
import { createRequestContext } from "../src/services/request-context.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeChild = path.join(here, "helpers", "fake-typecheck-child.mjs");
const roots: string[] = [];
const spawned: { entry: string; args: string[]; options: ForkOptions; child: ChildProcess }[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const { child } of spawned.splice(0)) child.kill("SIGKILL");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A project whose tooling resolves to the real v21 matrix workspace; the child itself is fake. */
async function createInput(
  extra: Partial<TemplateTypeCheckInput> = {},
): Promise<TemplateTypeCheckInput> {
  const tmp = path.join(here, "angular-matrix", "v21", ".tmp");
  await mkdir(tmp, { recursive: true });
  const root = await mkdtemp(path.join(tmp, "supervisor-"));
  roots.push(root);
  const tsConfigFilePath = path.join(root, "tsconfig.json");
  await writeFile(tsConfigFilePath, "{}\n");
  return { tsConfigFilePath, templates: [], overlay: [], changes: [], ...extra };
}

const spawnFake =
  (mode: string, payload?: string) =>
  (entry: string, args: string[], options: ForkOptions): ChildProcess => {
    const child = fork(fakeChild, [mode, ...(payload === undefined ? [] : [payload])], options);
    spawned.push({ entry, args, options, child });
    return child;
  };

const context = (remaining: number, signal?: AbortSignal): TemplateTypeCheckContext => {
  const base = createRequestContext(signal);
  return { signal: base.signal, checkpoint: () => base.checkpoint(), remainingMs: () => remaining };
};
const FAR = 100_000;
const run = async (mode: string, payload?: string, extra?: Partial<TemplateTypeCheckInput>) =>
  checkTemplateTypes(await createInput(extra), context(FAR), { spawn: spawnFake(mode, payload) });
const unfinished = (reason: string): TemplateDiagnostics =>
  ({
    status: "unfinished",
    reason,
    added: [],
    removed: [],
    addedErrors: [],
  }) as TemplateDiagnostics;

const wire = (over: object) => ({
  code: 2322,
  category: "Error",
  file: "src/a.component.html",
  line: 1,
  column: 1,
  message: "bad",
  start: 0,
  length: 3,
  ...over,
});

describe("checkBudgetMs", () => {
  it.each([
    [100_000, 30_000],
    [40_000, 30_000],
    [15_000, 5_000],
    [12_000, 2_000],
    [3_000, -7_000],
  ])("remaining %i ms gives a budget of %i ms", (remaining, budget) => {
    expect(checkBudgetMs(remaining)).toBe(budget);
  });
});

describe("template type-check supervisor", () => {
  it("diffs a valid reply through the plan's edits and classifies added errors", async () => {
    const beforeText = '<a [label]="t"></a><b [nonexistent]="t"></b>';
    const afterText = '<a [heading]="t"></a><b [nonexistent]="t"></b>';
    const existing = beforeText.indexOf("nonexistent");
    const reply = {
      v: 1,
      ok: true,
      before: [wire({ message: "unknown input", start: existing, length: 11 })],
      after: [
        wire({ message: "unknown input", start: existing + 2, length: 11 }),
        wire({ message: "renamed away", start: 4, length: 7 }),
        wire({ category: "Warning", message: "style", start: 30, length: 2 }),
      ],
    };
    const changes = [{ file: "src/a.component.html", beforeText, afterText }];
    const result = await run("reply", JSON.stringify(reply), { changes });
    expect(result).toMatchObject({ status: "completed", removed: [] });
    expect(result.added.map((d) => d.message)).toEqual(["renamed away", "style"]);
    expect(result.addedErrors.map((d) => d.message)).toEqual(["renamed away"]);
  });

  it.each([
    ["SIGABRT with a null code (the observed OOM form)", "abort", undefined, "work_exhausted"],
    ["exit code 134", "exit", "134", "work_exhausted"],
    ["any other non-zero exit", "exit", "3", "check_failed"],
    ["a clean exit without a reply", "silent", undefined, "check_failed"],
    ["a malformed reply", "malformed", undefined, "check_failed"],
    ["an oversized reply", "oversized", undefined, "work_exhausted"],
  ])("maps %s to unfinished/%s", async (_name, mode, payload, reason) => {
    expect(await run(mode, payload)).toEqual(unfinished(reason));
  });

  it.each([
    ["compiler_unsupported", "unavailable"],
    ["typescript_incompatible", "unavailable"],
    ["work_exhausted", "unfinished"],
    ["check_failed", "unfinished"],
  ])("maps a %s reply to %s with empty arrays", async (reason, status) => {
    const result = await run("reply", JSON.stringify({ v: 1, ok: false, reason }));
    expect(result).toEqual({ status, reason, added: [], removed: [], addedErrors: [] });
  });

  it("spawns a fixed, isolated child and sends the validated request", async () => {
    vi.stubEnv("NODE_OPTIONS", "--inspect=0");
    vi.stubEnv("AST_PARENT_SECRET", "leak");
    const input = await createInput({
      templates: ["/p/a.html"],
      overlay: [{ absolutePath: "/p/a.html", text: "<p></p>" }],
    });
    const result = await checkTemplateTypes(input, context(FAR), { spawn: spawnFake("echo") });
    const echoed = JSON.parse(result.added[0].message);

    expect(spawned).toHaveLength(1);
    expect(spawned[0].entry).toMatch(/angular-template-typecheck-entry\.js$/u);
    expect(spawned[0].options).toEqual({
      execPath: process.execPath,
      execArgv: ["--max-old-space-size=1024"],
      env: {},
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    expect(echoed.envKeys).toEqual([]);
    expect(echoed.execArgv).toEqual(["--max-old-space-size=1024"]);
    expect(echoed.request).toMatchObject({
      v: 1,
      tsconfig: input.tsConfigFilePath,
      templates: ["/p/a.html"],
      overlay: [{ absolutePath: "/p/a.html", text: "<p></p>" }],
      maxDiagnostics: 5000,
    });
    expect(echoed.request.cliEntry).toMatch(/v21\/node_modules\/@angular\/compiler-cli\/.+\.js$/u);
  });

  it("does not spawn when the preflight or the work limits refuse the request", async () => {
    const outside = { ...(await createInput()), tsConfigFilePath: "/nonexistent/tsconfig.json" };
    expect(
      await checkTemplateTypes(outside, context(FAR), { spawn: spawnFake("echo") }),
    ).toMatchObject({
      status: "unavailable",
    });
    const crowded = await createInput({
      templates: Array.from({ length: 2001 }, (_, i) => `/p/${i}.html`),
    });
    expect(await checkTemplateTypes(crowded, context(FAR), { spawn: spawnFake("echo") })).toEqual(
      unfinished("work_exhausted"),
    );
    expect(spawned).toHaveLength(0);
  });
});

describe("template type-check budget and kill", () => {
  it("reports deadline without spawning under 2 s of budget, and spawns at exactly 2 s", async () => {
    const input = await createInput();
    const spawn = spawnFake("reply", JSON.stringify({ v: 1, ok: true, before: [], after: [] }));
    expect(await checkTemplateTypes(input, context(11_999), { spawn })).toEqual(
      unfinished("deadline"),
    );
    expect(spawned).toHaveLength(0);
    expect(await checkTemplateTypes(input, context(12_000), { spawn })).toMatchObject({
      status: "completed",
    });
    expect(spawned).toHaveLength(1);
  });

  it("kills a hanging child with SIGKILL at the budget and reaps it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = checkTemplateTypes(await createInput(), context(12_000), {
      spawn: spawnFake("hang"),
    });
    expect(spawned).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(spawned[0].child.killed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(unfinished("deadline"));
    expect(spawned[0].child.signalCode).toBe("SIGKILL");
    expect(() => process.kill(spawned[0].child.pid!, 0)).toThrow(/ESRCH/u);
  });

  it("kills the child on abort and rethrows REQUEST_CANCELLED once it is reaped", async () => {
    const controller = new AbortController();
    const pending = checkTemplateTypes(await createInput(), context(FAR, controller.signal), {
      spawn: spawnFake("hang"),
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(spawned[0].child.signalCode).toBe("SIGKILL");
    expect(() => process.kill(spawned[0].child.pid!, 0)).toThrow(/ESRCH/u);
  });

  it("kills and reaps the child when it reports an error event", async () => {
    const pending = checkTemplateTypes(await createInput(), context(FAR), {
      spawn: spawnFake("hang"),
    });
    spawned[0].child.emit("error", new Error("channel failure"));
    expect(await pending).toEqual(unfinished("check_failed"));
    expect(spawned[0].child.signalCode).toBe("SIGKILL");
    expect(() => process.kill(spawned[0].child.pid!, 0)).toThrow(/ESRCH/u);
  });

  it("does not spawn when the request is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      checkTemplateTypes(await createInput(), context(FAR, controller.signal), {
        spawn: spawnFake("hang"),
      }),
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(spawned).toHaveLength(0);
  });
});
