import { constants, realpathSync } from "node:fs";
import {
  access,
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSymbolIndexCache,
  inspectSymbolIndexCache,
  SymbolIndexCacheError,
} from "../src/services/symbol-index-cache.js";

const roots: string[] = [];
const keyA = "a".repeat(64);
const keyB = "b".repeat(64);
const mainA = `symbol-index-${keyA}.sqlite`;
const mainB = `symbol-index-${keyB}.sqlite`;

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-symbol-index-cache-"));
  roots.push(root);
  return root;
}

function enabledEnvironment(root: string): NodeJS.ProcessEnv {
  return {
    AST_SYMBOL_INDEX_PERSISTENCE: "enabled",
    AST_SYMBOL_INDEX_CACHE_ROOT: root,
  };
}

async function capturedFailure(operation: Promise<unknown>): Promise<SymbolIndexCacheError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(SymbolIndexCacheError);
    return error as SymbolIndexCacheError;
  }
  throw new Error("Expected cache operation to fail.");
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("symbol-index cache lifecycle", () => {
  it("returns bounded disabled and missing results without resolving or creating a root", async () => {
    const homeLookup = vi.fn(() => {
      throw new Error("home lookup must not run");
    });
    const disabled = await inspectSymbolIndexCache({
      environment: { AST_SYMBOL_INDEX_PERSISTENCE: "disabled" },
      resolveHomeDirectory: homeLookup,
    });

    expect(disabled).toEqual({
      status: "ok",
      command: "cache inspect",
      policy: "disabled",
      backend: "memory",
      state: "disabled",
      regular_file_count: 0,
      total_bytes: 0,
      active_database_count: 0,
      sidecar_count: 0,
      quarantine_count: 0,
      unrecognized_regular_file_count: 0,
      unsafe_entry_count: 0,
    });
    expect(homeLookup).not.toHaveBeenCalled();

    const parent = await temporaryRoot();
    const missingRoot = path.join(parent, "missing", "cache");
    const missing = await inspectSymbolIndexCache({ environment: enabledEnvironment(missingRoot) });
    expect(missing).toMatchObject({
      status: "ok",
      policy: "enabled",
      backend: "sqlite",
      state: "missing",
      regular_file_count: 0,
      total_bytes: 0,
    });
    await expect(access(missingRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("strictly inventories canonical names recursively and accounts for unknown regular files", async () => {
    const root = await temporaryRoot();
    const nested = path.join(root, "nested");
    await mkdir(nested, { mode: 0o700 });
    const files = new Map<string, string>([
      [path.join(root, mainA), "database"],
      [path.join(root, `${mainA}-wal`), "wal"],
      [path.join(nested, `${mainB}-shm`), "shared"],
      [path.join(nested, `${mainB}.corrupt-123-456789`), "quarantine"],
      [path.join(root, `symbol-index-${keyA.toUpperCase()}.sqlite`), "uppercase"],
      [path.join(root, `symbol-index-${"c".repeat(63)}.sqlite`), "short"],
      [path.join(root, `${mainA}.corrupt-pid-now`), "malformed"],
      [path.join(root, "operation.astplan"), "unknown"],
    ]);
    await Promise.all([...files].map(([file, contents]) => writeFile(file, contents)));

    const result = await inspectSymbolIndexCache({ environment: enabledEnvironment(root) });
    const totalBytes = [...files.values()].reduce(
      (total, contents) => total + Buffer.byteLength(contents),
      0,
    );
    expect(result).toMatchObject({
      status: "ok",
      state: "ready",
      regular_file_count: files.size,
      total_bytes: totalBytes,
      active_database_count: 1,
      sidecar_count: 2,
      quarantine_count: 1,
      unrecognized_regular_file_count: 4,
      unsafe_entry_count: 0,
    });
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it("fails closed before retaining inventory records or bytes beyond explicit caps", async () => {
    const root = await temporaryRoot();
    await Promise.all([
      writeFile(path.join(root, "one"), "12"),
      writeFile(path.join(root, "two"), "34"),
      writeFile(path.join(root, "three"), "56"),
    ]);

    const recordsFailure = await capturedFailure(
      inspectSymbolIndexCache({
        environment: enabledEnvironment(root),
        limits: { maxRecords: 2, maxBytes: 100 },
      }),
    );
    expect(recordsFailure.code).toBe("CACHE_LIMIT");
    expect(recordsFailure.details).toMatchObject({ reason_counts: { record_limit: 1 } });

    const bytesFailure = await capturedFailure(
      inspectSymbolIndexCache({
        environment: enabledEnvironment(root),
        limits: { maxRecords: 10, maxBytes: 5 },
      }),
    );
    expect(bytesFailure.code).toBe("CACHE_LIMIT");
    expect(bytesFailure.details).toMatchObject({ reason_counts: { byte_limit: 1 } });
    expect(JSON.stringify([recordsFailure.message, recordsFailure.details])).not.toContain(root);
  });

  it("clears only recognized derived files, preserves directories and unknown files, and orders sidecars before mains", async () => {
    const root = await temporaryRoot();
    const nested = path.join(root, "nested");
    await mkdir(nested, { mode: 0o700 });
    const unknown = path.join(root, "source.ts");
    const plan = path.join(nested, "operation.astplan");
    await Promise.all([
      writeFile(path.join(root, mainB), "main-b"),
      writeFile(path.join(root, `${mainB}-wal`), "wal-b"),
      writeFile(path.join(root, `${mainB}-shm`), "shm-b"),
      writeFile(path.join(root, `${mainA}.corrupt-7-10`), "quarantine-a"),
      writeFile(unknown, "source"),
      writeFile(plan, "plan"),
    ]);
    const deletionOrder: string[] = [];

    const result = await clearSymbolIndexCache({
      environment: enabledEnvironment(root),
      testHooks: {
        beforeUnlink: ({ artifact, name }) => {
          deletionOrder.push(`${artifact}:${name}`);
        },
      },
    });

    expect(result).toMatchObject({
      status: "ok",
      command: "cache clear",
      state: "cleared",
      deleted_artifact_count: 4,
      deleted_active_database_count: 1,
      deleted_sidecar_count: 2,
      deleted_quarantine_count: 1,
      unrecognized_regular_file_count: 2,
      not_removed_artifact_count: 0,
      reason_counts: {},
    });
    expect(deletionOrder).toEqual([
      `quarantine:${mainA}.corrupt-7-10`,
      `shm:${mainB}-shm`,
      `wal:${mainB}-wal`,
      `active_database:${mainB}`,
    ]);
    await expect(readFile(unknown, "utf8")).resolves.toBe("source");
    await expect(readFile(plan, "utf8")).resolves.toBe("plan");
    await expect(access(nested)).resolves.toBeUndefined();
    await expect(access(path.join(root, mainB))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preflights the whole tree and refuses symlinks or canonical-name directories without deleting safe targets", async () => {
    const root = await temporaryRoot();
    const outsideRoot = await temporaryRoot();
    const outside = path.join(outsideRoot, "outside.sqlite");
    const safeMain = path.join(root, mainA);
    await writeFile(outside, "outside");
    await writeFile(safeMain, "safe");
    await symlink(outside, path.join(root, mainB));
    await mkdir(path.join(root, `${mainA}-wal`));

    const failure = await capturedFailure(
      clearSymbolIndexCache({ environment: enabledEnvironment(root) }),
    );
    expect(failure.code).toBe("CACHE_UNSAFE");
    expect(failure.details).toMatchObject({
      removed_artifact_count: 0,
      reason_counts: { symlink: 1, non_regular: 1 },
    });
    await expect(readFile(safeMain, "utf8")).resolves.toBe("safe");
    await expect(readFile(outside, "utf8")).resolves.toBe("outside");
    expect(JSON.stringify([failure.message, failure.details])).not.toContain(root);
    expect(JSON.stringify([failure.message, failure.details])).not.toContain(outsideRoot);
  });

  it("rejects multiply linked files before deleting any recognized artifact", async () => {
    const root = await temporaryRoot();
    const outsideRoot = await temporaryRoot();
    const linkedMain = path.join(root, mainA);
    const safeMain = path.join(root, mainB);
    await writeFile(linkedMain, "linked");
    await link(linkedMain, path.join(outsideRoot, "second-link"));
    await writeFile(safeMain, "safe");

    const failure = await capturedFailure(
      clearSymbolIndexCache({ environment: enabledEnvironment(root) }),
    );
    expect(failure.code).toBe("CACHE_UNSAFE");
    expect(failure.details).toMatchObject({
      removed_artifact_count: 0,
      reason_counts: { multiple_links: 1 },
    });
    await expect(readFile(linkedMain, "utf8")).resolves.toBe("linked");
    await expect(readFile(safeMain, "utf8")).resolves.toBe("safe");
  });

  it.skipIf(process.platform !== "linux" || (process.getuid?.() ?? 0) === 0)(
    "refuses an unreadable selected-tree entry before deletion",
    async () => {
      const root = await temporaryRoot();
      const safeMain = path.join(root, mainA);
      const unreadable = path.join(root, "unknown-private-file");
      await writeFile(safeMain, "safe");
      await writeFile(unreadable, "private");
      await chmod(unreadable, 0o000);
      try {
        const failure = await capturedFailure(
          clearSymbolIndexCache({ environment: enabledEnvironment(root) }),
        );
        expect(failure.code).toBe("CACHE_UNSAFE");
        expect(failure.details).toMatchObject({
          removed_artifact_count: 0,
          reason_counts: { unreadable: 1 },
        });
        await expect(access(safeMain, constants.F_OK)).resolves.toBeUndefined();
      } finally {
        await chmod(unreadable, 0o600);
      }
    },
  );

  it("refuses physically aliased roots without exposing the host path", async () => {
    const parent = await temporaryRoot();
    const physical = path.join(parent, "physical");
    const alias = path.join(parent, "alias");
    await mkdir(physical);
    await symlink(physical, alias);

    const failure = await capturedFailure(
      inspectSymbolIndexCache({
        environment: enabledEnvironment(path.join(alias, "cache")),
      }),
    );
    expect(failure.code).toBe("CACHE_UNSAFE_ROOT");
    expect(JSON.stringify([failure.message, failure.details])).not.toContain(parent);
  });

  it("rejects a group-or-other-accessible cache root without deleting its database", async () => {
    const root = await temporaryRoot();
    const main = path.join(root, mainA);
    const database = new DatabaseSync(main);
    database.exec("CREATE TABLE private_cache (value TEXT)");
    database.close();
    await chmod(root, 0o777);

    const failure = await capturedFailure(
      clearSymbolIndexCache({ environment: enabledEnvironment(root) }),
    );

    expect(failure.code).toBe("CACHE_UNSAFE_ROOT");
    expect(failure.details.reason_counts).toEqual({ unsafe_permissions: 1 });
    await expect(access(main)).resolves.toBeUndefined();
  });

  it("does not remove a target whose identity changes immediately before unlink", async () => {
    const root = await temporaryRoot();
    const main = path.join(root, mainA);
    await writeFile(main, "original");

    const failure = await capturedFailure(
      clearSymbolIndexCache({
        environment: enabledEnvironment(root),
        testHooks: {
          beforeUnlink: async () => {
            await rm(main);
            await writeFile(main, "replacement");
          },
        },
      }),
    );

    expect(failure.code).toBe("CACHE_PARTIAL");
    expect(failure.details).toMatchObject({
      removed_artifact_count: 0,
      not_removed_artifact_count: 1,
      reason_counts: { changed: 1 },
    });
    await expect(readFile(main, "utf8")).resolves.toBe("replacement");
  });

  it("never opens an outside SQLite replacement installed before guard acquisition", async () => {
    const root = await temporaryRoot();
    const outsideRoot = await temporaryRoot();
    const main = path.join(root, mainA);
    const displaced = path.join(root, "displaced.sqlite");
    const outside = path.join(outsideRoot, "outside.sqlite");
    for (const filePath of [main, outside]) {
      const database = new DatabaseSync(filePath);
      database.exec("CREATE TABLE evidence (value TEXT)");
      database.close();
    }
    const openedTargets: string[] = [];
    class DescriptorProbeDatabase {
      constructor(filePath: string) {
        openedTargets.push(realpathSync(filePath));
        return new DatabaseSync(filePath);
      }
    }

    const failure = await capturedFailure(
      clearSymbolIndexCache({
        environment: enabledEnvironment(root),
        DatabaseSync: DescriptorProbeDatabase as never,
        testHooks: {
          beforeUnlink: async ({ artifact }) => {
            if (artifact !== "active_database") return;
            await rename(main, displaced);
            await symlink(outside, main);
          },
        },
      }),
    );

    expect(failure.code).toBe("CACHE_UNSAFE");
    expect(failure.details).toMatchObject({
      removed_artifact_count: 0,
      reason_counts: { changed: 1 },
    });
    expect(openedTargets).toEqual([main]);
    expect(openedTargets).not.toContain(outside);
    await expect(access(displaced)).resolves.toBeUndefined();
    await expect(access(outside)).resolves.toBeUndefined();
    await expect(access(`${outside}-wal`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(`${outside}-shm`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not remove a target moved through a replacement parent immediately before unlink", async () => {
    const root = await temporaryRoot();
    const nested = path.join(root, "nested");
    const displaced = path.join(root, "displaced");
    const main = path.join(nested, mainA);
    await mkdir(nested, { mode: 0o700 });
    await writeFile(main, "original");

    const failure = await capturedFailure(
      clearSymbolIndexCache({
        environment: enabledEnvironment(root),
        testHooks: {
          beforeUnlink: async () => {
            await rename(nested, displaced);
            await mkdir(nested, { mode: 0o700 });
            await rename(path.join(displaced, mainA), main);
          },
        },
      }),
    );

    expect(failure.code).toBe("CACHE_PARTIAL");
    expect(failure.details).toMatchObject({
      removed_artifact_count: 0,
      not_removed_artifact_count: 1,
      reason_counts: { changed: 1 },
    });
    await expect(readFile(main, "utf8")).resolves.toBe("original");
  });

  it("reports bounded aggregate reasons after an injected partial unlink failure", async () => {
    const root = await temporaryRoot();
    const main = path.join(root, mainA);
    const wal = `${main}-wal`;
    await writeFile(main, "main");
    await writeFile(wal, "wal");

    const failure = await capturedFailure(
      clearSymbolIndexCache({
        environment: enabledEnvironment(root),
        testHooks: {
          beforeUnlink: ({ artifact }) => {
            if (artifact === "active_database") throw new Error("injected unlink failure");
          },
        },
      }),
    );

    expect(failure.code).toBe("CACHE_PARTIAL");
    expect(failure.details).toMatchObject({
      removed_artifact_count: 1,
      not_removed_artifact_count: 1,
      reason_counts: { delete_failed: 1 },
    });
    await expect(access(wal)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(main, "utf8")).resolves.toBe("main");
    expect(JSON.stringify([failure.message, failure.details])).not.toContain(root);
  });

  it("refuses a concurrently write-locked SQLite main before deleting anything", async () => {
    const root = await temporaryRoot();
    const main = path.join(root, mainA);
    const sidecar = `${main}-wal`;
    const database = new DatabaseSync(main);
    database.exec("PRAGMA journal_mode = WAL; CREATE TABLE held (value TEXT);");
    database.exec("BEGIN IMMEDIATE; INSERT INTO held VALUES ('x')");
    const sidecarBytes = await readFile(sidecar);
    try {
      const failure = await capturedFailure(
        clearSymbolIndexCache({ environment: enabledEnvironment(root) }),
      );
      expect(failure.code).toBe("CACHE_ACTIVE");
      expect(failure.details).toMatchObject({
        removed_artifact_count: 0,
        reason_counts: { active_database: 1 },
      });
      await expect(access(main)).resolves.toBeUndefined();
      await expect(readFile(sidecar)).resolves.toEqual(sidecarBytes);
    } finally {
      database.exec("ROLLBACK");
      database.close();
    }
  });

  it("refuses a SQLite writer that acquires the lock immediately before main unlink", async () => {
    const root = await temporaryRoot();
    const main = path.join(root, mainA);
    const seed = new DatabaseSync(main);
    seed.exec("CREATE TABLE held (value TEXT)");
    seed.close();

    let writer: DatabaseSync | undefined;
    try {
      const failure = await capturedFailure(
        clearSymbolIndexCache({
          environment: enabledEnvironment(root),
          testHooks: {
            beforeUnlink: ({ artifact }: { artifact: string }) => {
              if (artifact !== "active_database") return;
              writer = new DatabaseSync(main);
              writer.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
            },
          },
        }),
      );
      expect(failure.code).toBe("CACHE_ACTIVE");
      expect(failure.details).toMatchObject({
        removed_artifact_count: 0,
        reason_counts: { active_database: 1 },
      });
      await expect(access(main)).resolves.toBeUndefined();
    } finally {
      if (writer) {
        writer.exec("ROLLBACK");
        writer.close();
      }
    }
  });

  it.each(["reader", "writer"] as const)(
    "fails closed when a late SQLite %s changes the group before WAL or SHM unlink",
    async (activity) => {
      const root = await temporaryRoot();
      const main = path.join(root, mainA);
      const wal = `${main}-wal`;
      const shm = `${main}-shm`;
      let seed: DatabaseSync | undefined = new DatabaseSync(main);
      seed.exec(
        "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE held (value TEXT); INSERT INTO held VALUES ('seed')",
      );

      let participant: DatabaseSync | undefined;
      try {
        const failure = await capturedFailure(
          clearSymbolIndexCache({
            environment: enabledEnvironment(root),
            testHooks: {
              beforeUnlink: ({ artifact }) => {
                if ((artifact !== "shm" && artifact !== "wal") || participant) return;
                seed?.close();
                seed = undefined;
                participant = new DatabaseSync(main);
                participant.exec("PRAGMA busy_timeout = 0; BEGIN");
                if (activity === "reader") {
                  participant.prepare("SELECT value FROM held").all();
                } else {
                  participant.exec("INSERT INTO held VALUES ('late writer')");
                }
              },
            },
          }),
        );

        expect(failure.code).toBe("CACHE_UNSAFE");
        expect(failure.details).toMatchObject({
          removed_artifact_count: 0,
          reason_counts: { changed: 1 },
        });
        await expect(access(main)).resolves.toBeUndefined();
        await expect(access(wal)).resolves.toBeUndefined();
        await expect(access(shm)).resolves.toBeUndefined();
      } finally {
        if (participant) {
          participant.exec("ROLLBACK");
          participant.close();
        }
        seed?.close();
      }
    },
  );

  it("keeps corrupt quarantine artifacts explicitly clearable as derived data", async () => {
    const root = await temporaryRoot();
    const quarantine = path.join(root, `${mainA}.corrupt-99-1234567890`);
    await writeFile(quarantine, "not a sqlite database");

    const result = await clearSymbolIndexCache({ environment: enabledEnvironment(root) });
    expect(result).toMatchObject({
      deleted_artifact_count: 1,
      deleted_quarantine_count: 1,
      not_removed_artifact_count: 0,
    });
    await expect(access(quarantine)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
