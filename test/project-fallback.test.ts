import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const watcherFactory = vi.hoisted(() => vi.fn());

vi.mock("../src/services/project-watcher.js", () => ({
  createProjectWatcher: watcherFactory,
}));

type ProjectApi = typeof import("../src/services/project.js");

let projectApi: ProjectApi | undefined;
let fixtureRoot: string | undefined;

async function createFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-project-fallback-"));
  await mkdir(path.join(root, "src"));
  await writeFile(
    path.join(root, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(root, "src", "value.ts"), "export const before = 1;\n");
  return root;
}

beforeEach(async () => {
  projectApi = await import("../src/services/project.js");
  watcherFactory.mockImplementation((options: { onError: (error: Error) => void }) => ({
    start: vi.fn(() => options.onError(new Error("watcher overflow"))),
    close: vi.fn(),
    snapshot: () => ({
      state: "failed",
      watched_directories: 0,
      pending_paths: [],
      pending_paths_truncated: false,
    }),
  }));
  fixtureRoot = await createFixture();
});

afterEach(async () => {
  projectApi?.clearProjectSessions();
  if (fixtureRoot !== undefined) await rm(fixtureRoot, { recursive: true, force: true });
  watcherFactory.mockReset();
  projectApi = undefined;
  fixtureRoot = undefined;
});

describe("project synchronization fallback", () => {
  it("serves exact reads from a synchronous refresh while watcher status stays degraded", async () => {
    const root = fixtureRoot as string;
    const api = projectApi as ProjectApi;

    const first = await api.withProject(root, ({ project }) =>
      api.getSourceFileOrThrow(project, "src/value.ts").getText(),
    );
    expect(first).toContain("before");

    await writeFile(path.join(root, "src", "value.ts"), "export const after = 2;\n");

    const second = await api.withProject(root, ({ project }) =>
      api.getSourceFileOrThrow(project, "src/value.ts").getText(),
    );
    expect(second).toContain("after");
    expect(second).not.toContain("before");

    const status = await api.getProjectStatus(root);
    expect(status.state).toBe("degraded");
    expect(status.causes).toContain("watcher_failure");
    expect(status.watcher).toEqual({ state: "failed" });
  });
});
