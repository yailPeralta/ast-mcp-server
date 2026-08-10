import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProjectWatcher,
  selectProjectWatchDirectories,
  type ProjectWatcher,
  type WatchFactory,
} from "../src/services/project-watcher.js";

interface FakeHandle {
  readonly directory: string;
  readonly emit: (eventType: "rename" | "change", filename: string | null) => void;
  readonly fail: (error: unknown) => void;
  readonly closed: () => boolean;
}

const temporaryRoots: string[] = [];

function createTemporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ast-project-watcher-"));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, "src"));
  return root;
}

function createFakeWatchFactory(): {
  factory: WatchFactory;
  handles: FakeHandle[];
} {
  const handles: FakeHandle[] = [];
  const factory: WatchFactory = (directory, onEvent, onError) => {
    let isClosed = false;
    const handle: FakeHandle = {
      directory,
      emit: (eventType, filename) => {
        if (!isClosed) onEvent(eventType, filename);
      },
      fail: (error) => {
        if (!isClosed) onError(error);
      },
      closed: () => isClosed,
    };
    handles.push(handle);
    return {
      close: () => {
        isClosed = true;
      },
    };
  };
  return { factory, handles };
}

function createWatcher(overrides: Partial<Parameters<typeof createProjectWatcher>[0]> = {}): {
  watcher: ProjectWatcher;
  fake: ReturnType<typeof createFakeWatchFactory>;
  changes: string[][];
  errors: unknown[];
} {
  const projectRoot = createTemporaryRoot();
  const fake = createFakeWatchFactory();
  const changes: string[][] = [];
  const errors: unknown[] = [];
  const watcher = createProjectWatcher({
    projectRoot,
    directories: [projectRoot, path.join(projectRoot, "src")],
    debounceMs: 25,
    watchFactory: fake.factory,
    onChange: (files) => changes.push([...files]),
    onError: (error) => errors.push(error),
    ...overrides,
  });
  return { watcher, fake, changes, errors };
}

afterEach(() => {
  vi.useRealTimers();
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("project watcher", () => {
  it("selects compiler source directories and excludes derived trees", () => {
    const projectRoot = createTemporaryRoot();
    const nested = path.join(projectRoot, "src/nested");
    fs.mkdirSync(nested);
    const dependency = path.join(projectRoot, "node_modules/dependency");
    fs.mkdirSync(dependency, { recursive: true });
    expect(
      selectProjectWatchDirectories(projectRoot, [
        path.join(projectRoot, "src/value.ts"),
        path.join(nested, "other.ts"),
        path.join(dependency, "index.d.ts"),
        "/outside/ignored.ts",
      ]),
    ).toEqual([projectRoot, path.join(projectRoot, "src"), nested]);
  });

  it("excludes compiler source directories that physically escape through a symlink", () => {
    const projectRoot = createTemporaryRoot();
    const externalRoot = createTemporaryRoot();
    const linked = path.join(projectRoot, "linked");
    fs.symlinkSync(path.join(externalRoot, "src"), linked, "dir");

    expect(selectProjectWatchDirectories(projectRoot, [path.join(linked, "external.ts")])).toEqual([
      projectRoot,
    ]);
  });

  it("starts one handle per directory and debounces duplicate changes", () => {
    vi.useFakeTimers();
    const { watcher, fake, changes } = createWatcher();

    watcher.start();
    expect(watcher.snapshot()).toMatchObject({
      state: "ready",
      watched_directories: 2,
      pending_paths: [],
      pending_paths_truncated: false,
    });

    fake.handles[1].emit("change", "value.ts");
    fake.handles[1].emit("change", "value.ts");
    fake.handles[0].emit("change", "tsconfig.json");
    vi.advanceTimersByTime(24);
    expect(changes).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(changes).toEqual([["src/value.ts", "tsconfig.json"]]);
    expect(watcher.snapshot().pending_paths).toEqual([]);
  });

  it("fails closed on event overflow instead of delivering incomplete paths", () => {
    vi.useFakeTimers();
    const { watcher, fake, changes, errors } = createWatcher({ maxPendingPaths: 65 });

    watcher.start();
    for (let index = 0; index < 200; index += 1) {
      fake.handles[1].emit("change", `file-${index}.ts`);
    }

    expect(watcher.snapshot()).toMatchObject({
      state: "failed",
      watched_directories: 0,
      pending_paths: [],
      pending_paths_truncated: false,
    });
    vi.advanceTimersByTime(25);
    expect(changes).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(fake.handles.every((handle) => handle.closed())).toBe(true);
  });

  it("reports backend errors and closes all handles without late callbacks", () => {
    vi.useFakeTimers();
    const { watcher, fake, changes, errors } = createWatcher();

    watcher.start();
    fake.handles[0].fail(new Error("watch failed"));
    expect(watcher.snapshot()).toMatchObject({ state: "failed", watched_directories: 0 });
    expect(errors).toHaveLength(1);

    watcher.close();
    expect(watcher.snapshot()).toMatchObject({ state: "disabled", pending_paths: [] });
    expect(fake.handles.every((handle) => handle.closed())).toBe(true);
    fake.handles[1].emit("change", "late.ts");
    vi.advanceTimersByTime(25);
    expect(changes).toEqual([]);
  });

  it("closes partial startup handles when a directory cannot be watched", () => {
    const projectRoot = createTemporaryRoot();
    const fake = createFakeWatchFactory();
    const errors: unknown[] = [];
    const watcher = createProjectWatcher({
      projectRoot,
      directories: [projectRoot, path.join(projectRoot, "src")],
      watchFactory: (
        directory: string,
        onEvent: Parameters<WatchFactory>[1],
        onError: Parameters<WatchFactory>[2],
      ) => {
        if (directory === path.join(projectRoot, "src")) throw new Error("startup failed");
        return fake.factory(directory, onEvent, onError);
      },
      onChange: () => undefined,
      onError: (error: unknown) => errors.push(error),
    });

    watcher.start();

    expect(watcher.snapshot()).toMatchObject({ state: "failed", watched_directories: 0 });
    expect(errors).toHaveLength(1);
    expect(fake.handles[0].closed()).toBe(true);
  });

  it("fails closed before opening configured directories beyond the bound", () => {
    const { watcher, fake, errors } = createWatcher({ maxWatchedDirectories: 1 });

    watcher.start();

    expect(watcher.snapshot()).toMatchObject({ state: "failed", watched_directories: 0 });
    expect(fake.handles).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("is idempotent when started or closed more than once", () => {
    const { watcher, fake } = createWatcher();

    watcher.start();
    watcher.start();
    expect(fake.handles).toHaveLength(2);

    watcher.close();
    watcher.close();
    expect(fake.handles.every((handle) => handle.closed())).toBe(true);
  });
});
