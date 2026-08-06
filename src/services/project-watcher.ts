import fs, { type FSWatcher, type WatchEventType } from "node:fs";
import path from "node:path";

export const DEFAULT_WATCHER_DEBOUNCE_MS = 100;
export const DEFAULT_MAX_PENDING_PATHS = 65;
export const DEFAULT_MAX_WATCHED_DIRECTORIES = 512;

const IGNORED_DIRECTORY_NAMES = new Set([".git", ".yarn", "coverage", "dist", "node_modules"]);

type WatchEventListener = (eventType: WatchEventType, filename: string | Buffer | null) => void;
type WatchErrorListener = (error: unknown) => void;

export interface WatchHandle {
  close(): void;
}

export type WatchFactory = (
  directory: string,
  onEvent: WatchEventListener,
  onError: WatchErrorListener,
) => WatchHandle;

export type ProjectWatcherState = "disabled" | "ready" | "failed";

export interface ProjectWatcherSnapshot {
  readonly state: ProjectWatcherState;
  readonly watched_directories: number;
  readonly pending_paths: readonly string[];
  readonly pending_paths_truncated: boolean;
}

export interface ProjectWatcherOptions {
  readonly projectRoot: string;
  readonly directories?: readonly string[];
  readonly debounceMs?: number;
  readonly maxPendingPaths?: number;
  readonly maxWatchedDirectories?: number;
  readonly watchFactory?: WatchFactory;
  readonly onChange: (files: readonly string[]) => void;
  readonly onError: (error: unknown) => void;
}

export interface ProjectWatcher {
  start(): void;
  close(): void;
  snapshot(): ProjectWatcherSnapshot;
}

function defaultWatchFactory(
  directory: string,
  onEvent: WatchEventListener,
  onError: WatchErrorListener,
): FSWatcher {
  const watcher = fs.watch(directory, { persistent: false }, onEvent);
  watcher.on("error", onError);
  return watcher;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`Watcher numeric options must be integers >= ${minimum}.`);
  }
  return value;
}

function normalizeDirectory(projectRoot: string, directory: string): string {
  const normalizedRoot = path.resolve(projectRoot);
  const normalizedDirectory = path.resolve(directory);
  if (
    normalizedDirectory !== normalizedRoot &&
    !normalizedDirectory.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new Error(`Watcher directory must stay inside the project root: ${directory}.`);
  }
  return normalizedDirectory;
}

function discoverDirectories(projectRoot: string, maxDirectories: number): readonly string[] {
  const directories = [projectRoot];
  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index];
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        IGNORED_DIRECTORY_NAMES.has(entry.name)
      ) {
        continue;
      }
      directories.push(path.join(directory, entry.name));
      if (directories.length > maxDirectories) {
        throw new Error(`Watcher directory limit exceeded (${maxDirectories}).`);
      }
    }
  }
  return directories;
}

function normalizeFilename(
  projectRoot: string,
  watchedDirectory: string,
  filename: string | Buffer | null,
): string {
  const filenameText = filename === null ? "" : filename.toString();
  const absolutePath = filenameText
    ? path.resolve(watchedDirectory, filenameText)
    : watchedDirectory;
  const relativePath = path.relative(projectRoot, absolutePath).split(path.sep).join("/");
  if (
    relativePath === "" ||
    relativePath === "." ||
    relativePath.startsWith("../") ||
    path.isAbsolute(relativePath)
  ) {
    return ".";
  }
  return relativePath;
}

function createWatcher(options: ProjectWatcherOptions): ProjectWatcher {
  if (typeof options.onChange !== "function" || typeof options.onError !== "function") {
    throw new Error("Watcher callbacks must be functions.");
  }
  const projectRoot = path.resolve(options.projectRoot);
  const debounceMs = boundedInteger(options.debounceMs, DEFAULT_WATCHER_DEBOUNCE_MS, 0);
  const maxPendingPaths = boundedInteger(options.maxPendingPaths, DEFAULT_MAX_PENDING_PATHS, 1);
  const maxWatchedDirectories = boundedInteger(
    options.maxWatchedDirectories,
    DEFAULT_MAX_WATCHED_DIRECTORIES,
    1,
  );
  const watchFactory = options.watchFactory ?? defaultWatchFactory;
  const configuredDirectories =
    options.directories === undefined
      ? undefined
      : [
          ...new Set(
            options.directories.map((directory) => normalizeDirectory(projectRoot, directory)),
          ),
        ];

  let state: ProjectWatcherState = "disabled";
  let handles: WatchHandle[] = [];
  let pendingPaths = new Map<string, true>();
  let pendingPathsTruncated = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearPendingTimer = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const closeHandles = (): void => {
    const currentHandles = handles;
    handles = [];
    for (const handle of currentHandles) {
      try {
        handle.close();
      } catch {
        // Closing an already-failed native watcher is best effort.
      }
    }
  };

  const notifyError = (error: unknown): void => {
    try {
      options.onError(error);
    } catch {
      // Observer errors must not escape the filesystem callback.
    }
  };

  const markFailed = (error: unknown): void => {
    if (state === "disabled" && handles.length === 0) return;
    clearPendingTimer();
    pendingPaths = new Map();
    pendingPathsTruncated = false;
    closeHandles();
    state = "failed";
    notifyError(error);
  };

  const flush = (): void => {
    timer = undefined;
    if (state !== "ready" || pendingPaths.size === 0) return;
    const files = [...pendingPaths.keys()];
    pendingPaths = new Map();
    pendingPathsTruncated = false;
    try {
      options.onChange(files);
    } catch (error) {
      markFailed(error);
    }
  };

  const scheduleFlush = (): void => {
    clearPendingTimer();
    timer = setTimeout(flush, debounceMs);
  };

  const handleEvent = (
    watchedDirectory: string,
    _eventType: WatchEventType,
    filename: string | Buffer | null,
  ): void => {
    if (state !== "ready") return;
    const relativePath = normalizeFilename(projectRoot, watchedDirectory, filename);
    if (!pendingPaths.has(relativePath)) {
      if (pendingPaths.size >= maxPendingPaths) {
        pendingPathsTruncated = true;
      } else {
        pendingPaths.set(relativePath, true);
      }
    }
    scheduleFlush();
  };

  return {
    start(): void {
      if (state === "ready") return;
      clearPendingTimer();
      pendingPaths = new Map();
      pendingPathsTruncated = false;
      const nextHandles: WatchHandle[] = [];
      try {
        const directories =
          configuredDirectories ?? discoverDirectories(projectRoot, maxWatchedDirectories);
        for (const directory of directories) {
          nextHandles.push(
            watchFactory(
              directory,
              (eventType, filename) => handleEvent(directory, eventType, filename),
              markFailed,
            ),
          );
        }
        handles = nextHandles;
        state = "ready";
      } catch (error) {
        for (const handle of nextHandles) {
          try {
            handle.close();
          } catch {
            // Partial startup cleanup is best effort.
          }
        }
        state = "failed";
        notifyError(error);
      }
    },

    close(): void {
      clearPendingTimer();
      pendingPaths = new Map();
      pendingPathsTruncated = false;
      closeHandles();
      state = "disabled";
    },

    snapshot(): ProjectWatcherSnapshot {
      return {
        state,
        watched_directories: handles.length,
        pending_paths: [...pendingPaths.keys()],
        pending_paths_truncated: pendingPathsTruncated,
      };
    },
  };
}

export function createProjectWatcher(options: ProjectWatcherOptions): ProjectWatcher {
  return createWatcher(options);
}
