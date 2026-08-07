import { describe, expect, it } from "vitest";
import {
  MAX_DEGRADED_ERRORS,
  MAX_PENDING_FILENAME_LENGTH,
  MAX_PENDING_FILES,
  MAX_STATUS_TEXT_LENGTH,
  createInitialProjectStatus,
  createProjectIdentity,
  projectStatusToProjection,
  transitionProjectStatus,
  type ProjectStatus,
} from "../src/services/project-status.js";
import { isJsonValue } from "../src/services/read-contracts.js";

const identity = createProjectIdentity({
  projectRoot: "/home/yail/workspaces/example-project",
  configPath: "/home/yail/workspaces/example-project/tsconfig.json",
});
const sourceFingerprintV1 = `source_${"a".repeat(64)}`;
const sourceFingerprintV2 = `source_${"b".repeat(64)}`;
const sourceFingerprintV3 = `source_${"c".repeat(64)}`;
const configFingerprintV1 = `config_${"a".repeat(64)}`;
const configFingerprintV2 = `config_${"b".repeat(64)}`;
const configFingerprintV3 = `config_${"c".repeat(64)}`;

function freshStatus() {
  const initial = createInitialProjectStatus(identity, {
    sourceCount: 4,
    indexedCount: 4,
  });
  return transitionProjectStatus(initial, {
    type: "sync_succeeded",
    sourceCount: 4,
    indexedCount: 4,
    sourceSnapshotFingerprint: sourceFingerprintV1,
    configSnapshotFingerprint: configFingerprintV1,
    at: "2026-08-04T12:00:00.000Z",
  });
}

describe("project status", () => {
  it("canonicalizes untrusted fingerprint values before projection", () => {
    const projection = projectStatusToProjection({
      ...freshStatus(),
      sourceSnapshotFingerprint: `source_${"a".repeat(10000)}`,
      configSnapshotFingerprint: "token=sample-value",
      canonicalSnapshotFingerprint: "snapshot/../../credentials",
    });

    expect(projection.source_snapshot_fingerprint).toMatch(/^source_[0-9a-f]{64}$/);
    expect(projection.config_snapshot_fingerprint).toMatch(/^config_[0-9a-f]{64}$/);
    expect(projection.canonical_snapshot_fingerprint).toMatch(/^snapshot_[0-9a-f]{64}$/);
    expect(JSON.stringify(projection)).not.toContain("sample-value");
  });

  it("hashes the original bytes of noncanonical fingerprints", () => {
    const paddedCanonical = projectStatusToProjection({
      ...freshStatus(),
      sourceSnapshotFingerprint: `${sourceFingerprintV1} `,
    });
    const unpadded = projectStatusToProjection({
      ...freshStatus(),
      sourceSnapshotFingerprint: "opaque-fingerprint",
    });
    const padded = projectStatusToProjection({
      ...freshStatus(),
      sourceSnapshotFingerprint: "opaque-fingerprint ",
    });

    expect(paddedCanonical.source_snapshot_fingerprint).not.toBe(sourceFingerprintV1);
    expect(unpadded.source_snapshot_fingerprint).not.toBe(padded.source_snapshot_fingerprint);
  });

  it("redacts credentials from degraded error evidence", () => {
    const projection = projectStatusToProjection(
      transitionProjectStatus(freshStatus(), {
        type: "watcher_failed",
        error: [
          "Authorization",
          String.fromCharCode(58),
          " opaque-value; api_key=",
          "sample-value",
        ].join(""),
      }),
    );

    expect(projection.degraded_errors).toEqual([
      ["Authorization: ", "[REDACTED]; api_key=[REDACTED]"].join(""),
    ]);
  });

  it("redacts multi-token authorization values", () => {
    const projection = projectStatusToProjection(
      transitionProjectStatus(freshStatus(), {
        type: "watcher_failed",
        error: [
          "Authorization",
          String.fromCharCode(58),
          " Basic opaque-one opaque-two; context",
        ].join(""),
      }),
    );

    expect(projection.degraded_errors).toEqual(["Authorization: [REDACTED]; context"]);
  });

  it("starts pending until canonical synchronization evidence exists", () => {
    const projection = projectStatusToProjection(
      createInitialProjectStatus(identity, {
        sourceCount: 4,
        indexedCount: 4,
      }),
    );

    expect(projection).toMatchObject({
      state: "pending",
      causes: [],
      source_count: 4,
      indexed_count: 0,
      pending_files: [],
      pending_files_truncated: false,
      pending_files_truncation: { truncated: false, reason: null },
      pending_files_filename_truncation: { truncated: false, reason: null },
      compiler: { state: "ready" },
      index: { state: "disabled" },
      watcher: { state: "disabled" },
      last_successful_sync_at: null,
      source_snapshot_fingerprint: null,
      config_snapshot_fingerprint: null,
      canonical_snapshot_fingerprint: null,
    });
  });

  it("does not treat counts and a timestamp alone as freshness evidence", () => {
    const projection = projectStatusToProjection(
      transitionProjectStatus(createInitialProjectStatus(identity), {
        type: "sync_succeeded",
        sourceCount: 5,
        indexedCount: 5,
        at: "2026-08-04T12:00:00.000Z",
      }),
    );

    expect(projection).toMatchObject({
      state: "pending",
      source_count: 5,
      indexed_count: 0,
      last_successful_sync_at: null,
      source_snapshot_fingerprint: null,
      config_snapshot_fingerprint: null,
      canonical_snapshot_fingerprint: null,
    });
  });

  it("does not treat source-only or config-only initial sync evidence as complete", () => {
    const sourceOnly = projectStatusToProjection(
      transitionProjectStatus(createInitialProjectStatus(identity), {
        type: "sync_succeeded",
        sourceCount: 5,
        indexedCount: 5,
        sourceSnapshotFingerprint: sourceFingerprintV1,
        at: "2026-08-04T12:00:00.000Z",
      }),
    );
    const configOnly = projectStatusToProjection(
      transitionProjectStatus(createInitialProjectStatus(identity), {
        type: "sync_succeeded",
        sourceCount: 5,
        indexedCount: 5,
        configSnapshotFingerprint: configFingerprintV1,
        at: "2026-08-04T12:00:00.000Z",
      }),
    );

    expect(sourceOnly).toMatchObject({
      state: "pending",
      last_successful_sync_at: null,
      source_snapshot_fingerprint: sourceFingerprintV1,
      config_snapshot_fingerprint: null,
    });
    expect(configOnly).toMatchObject({
      state: "pending",
      last_successful_sync_at: null,
      source_snapshot_fingerprint: null,
      config_snapshot_fingerprint: configFingerprintV1,
    });
  });

  it("preserves active index states across status transitions", () => {
    const futureIndexStates = ["ready", "rebuilding", "failed"] as const;

    for (const indexState of futureIndexStates) {
      let status: ProjectStatus = {
        ...freshStatus(),
        indexedCount: 99,
        index: { state: indexState },
        lastSuccessfulIndexAt: "2026-08-04T12:00:00.000Z",
      };

      const expectIndex = (
        current: ProjectStatus,
        expectedState: typeof indexState | "rebuilding",
      ) => {
        expect(projectStatusToProjection(current)).toMatchObject({
          indexed_count: 99,
          index: { state: expectedState },
          last_successful_index_at: "2026-08-04T12:00:00.000Z",
        });
      };

      expectIndex(status, indexState);
      status = transitionProjectStatus(status, {
        type: "source_changed",
        files: ["src/value.ts"],
      });
      expectIndex(status, indexState);
      status = transitionProjectStatus(status, { type: "config_changed" });
      expectIndex(status, indexState);
      status = transitionProjectStatus(status, { type: "compiler_rebuild_started" });
      expectIndex(status, indexState === "ready" ? "rebuilding" : indexState);
      status = transitionProjectStatus(status, {
        type: "sync_succeeded",
        sourceCount: 5,
        indexedCount: 5,
        sourceSnapshotFingerprint: sourceFingerprintV2,
        configSnapshotFingerprint: configFingerprintV2,
        at: "2026-08-04T12:01:00.000Z",
      });
      expect(projectStatusToProjection(status)).toMatchObject({
        indexed_count: indexState === "failed" ? 0 : 5,
        index: { state: indexState === "failed" ? "failed" : "ready" },
        last_successful_index_at:
          indexState === "failed" ? "2026-08-04T12:00:00.000Z" : "2026-08-04T12:01:00.000Z",
      });
      status = transitionProjectStatus(status, { type: "index_recovered" });
      expect(projectStatusToProjection(status)).toMatchObject({
        indexed_count: indexState === "failed" ? 0 : 5,
        index: { state: "ready" },
        last_successful_index_at:
          indexState === "failed" ? "2026-08-04T12:00:00.000Z" : "2026-08-04T12:01:00.000Z",
      });
    }
  });

  it("retains invalidation evidence after source-only or config-only sync events", () => {
    const sourceInvalidated = transitionProjectStatus(freshStatus(), {
      type: "source_changed",
      files: ["src/source.ts"],
    });
    const sourcePartial = projectStatusToProjection(
      transitionProjectStatus(sourceInvalidated, {
        type: "sync_succeeded",
        sourceCount: 5,
        indexedCount: 5,
        sourceSnapshotFingerprint: sourceFingerprintV2,
        at: "2026-08-04T12:01:00.000Z",
      }),
    );
    const configInvalidated = transitionProjectStatus(freshStatus(), {
      type: "config_changed",
    });
    const configPartial = projectStatusToProjection(
      transitionProjectStatus(configInvalidated, {
        type: "sync_succeeded",
        sourceCount: 5,
        indexedCount: 5,
        configSnapshotFingerprint: configFingerprintV2,
        at: "2026-08-04T12:01:00.000Z",
      }),
    );

    expect(sourcePartial).toMatchObject({
      state: "pending",
      causes: ["source_change"],
      pending_files: ["src/source.ts"],
      last_successful_sync_at: "2026-08-04T12:00:00.000Z",
      source_snapshot_fingerprint: sourceFingerprintV2,
    });
    expect(configPartial).toMatchObject({
      state: "pending",
      causes: ["config_change"],
      pending_files: [],
      last_successful_sync_at: "2026-08-04T12:00:00.000Z",
      config_snapshot_fingerprint: configFingerprintV2,
    });
  });

  it("moves to pending and records source and config changes", () => {
    const sourceChanged = transitionProjectStatus(freshStatus(), {
      type: "source_changed",
      files: ["src/value.ts", "src/other.ts"],
    });
    const configChanged = transitionProjectStatus(sourceChanged, {
      type: "config_changed",
    });
    const projection = projectStatusToProjection(configChanged);

    expect(projection.state).toBe("pending");
    expect(projection.causes).toEqual(["source_change", "config_change"]);
    expect(projection.pending_files).toEqual(["src/value.ts", "src/other.ts"]);
  });

  it("moves through compiler rebuilding and returns fresh after a successful sync", () => {
    const pending = transitionProjectStatus(freshStatus(), {
      type: "source_changed",
      files: ["src/value.ts"],
    });
    const rebuilding = transitionProjectStatus(pending, {
      type: "compiler_rebuild_started",
    });
    const rebuildingProjection = projectStatusToProjection(rebuilding);

    expect(rebuildingProjection).toMatchObject({
      state: "rebuilding",
      causes: ["source_change", "compiler_rebuild"],
      compiler: { state: "rebuilding" },
      index: { state: "disabled" },
    });

    const fresh = transitionProjectStatus(rebuilding, {
      type: "sync_succeeded",
      sourceCount: 5,
      indexedCount: 5,
      sourceSnapshotFingerprint: sourceFingerprintV2,
      configSnapshotFingerprint: configFingerprintV2,
      at: "2026-08-04T12:00:00.000Z",
    });

    expect(projectStatusToProjection(fresh)).toMatchObject({
      state: "fresh",
      causes: [],
      source_count: 5,
      indexed_count: 0,
      pending_files: [],
      compiler: { state: "ready" },
      index: { state: "disabled" },
      last_successful_sync_at: "2026-08-04T12:00:00.000Z",
      last_successful_index_at: null,
      source_snapshot_fingerprint: sourceFingerprintV2,
      config_snapshot_fingerprint: configFingerprintV2,
    });
  });

  it("keeps index failure dominant through rebuild and complete sync until recovery", () => {
    const baseline = freshStatus();
    const indexFailed = transitionProjectStatus(baseline, {
      type: "index_failed",
      error: "index unavailable",
    });
    const rebuilding = transitionProjectStatus(indexFailed, {
      type: "compiler_rebuild_started",
    });
    const blockedSync = transitionProjectStatus(rebuilding, {
      type: "sync_succeeded",
      sourceCount: 4,
      indexedCount: 4,
      sourceSnapshotFingerprint: sourceFingerprintV2,
      configSnapshotFingerprint: configFingerprintV2,
      at: "2026-08-04T12:01:00.000Z",
    });

    expect(projectStatusToProjection(blockedSync)).toMatchObject({
      state: "degraded",
      causes: expect.arrayContaining(["index_failure"]),
      indexed_count: 0,
      index: { state: "failed" },
      last_successful_sync_at: "2026-08-04T12:00:00.000Z",
      last_successful_index_at: null,
      degraded_errors: ["index unavailable"],
    });

    const recovered = transitionProjectStatus(blockedSync, {
      type: "index_recovered",
    });
    expect(projectStatusToProjection(recovered)).toMatchObject({
      state: "pending",
      causes: expect.not.arrayContaining(["index_failure"]),
      index: { state: "ready" },
      degraded_errors: [],
    });

    const freshAgain = transitionProjectStatus(recovered, {
      type: "sync_succeeded",
      sourceCount: 4,
      indexedCount: 4,
      sourceSnapshotFingerprint: sourceFingerprintV3,
      configSnapshotFingerprint: configFingerprintV3,
      at: "2026-08-04T12:02:00.000Z",
    });
    expect(projectStatusToProjection(freshAgain)).toMatchObject({
      state: "fresh",
      causes: [],
      indexed_count: 4,
      index: { state: "ready" },
      last_successful_sync_at: "2026-08-04T12:02:00.000Z",
      last_successful_index_at: "2026-08-04T12:02:00.000Z",
    });
  });

  it("does not advance the successful sync timestamp during a degraded watcher sync", () => {
    const baseline = freshStatus();
    const watcherFailed = transitionProjectStatus(baseline, {
      type: "watcher_failed",
      error: "watcher unavailable",
    });
    const rebuilding = transitionProjectStatus(watcherFailed, {
      type: "compiler_rebuild_started",
    });
    const blockedSync = transitionProjectStatus(rebuilding, {
      type: "sync_succeeded",
      sourceCount: 4,
      indexedCount: 4,
      sourceSnapshotFingerprint: sourceFingerprintV2,
      configSnapshotFingerprint: configFingerprintV2,
      at: "2026-08-04T12:01:00.000Z",
    });

    expect(projectStatusToProjection(blockedSync)).toMatchObject({
      state: "degraded",
      causes: expect.arrayContaining(["watcher_failure"]),
      watcher: { state: "failed" },
      indexed_count: 0,
      index: { state: "disabled" },
      last_successful_sync_at: "2026-08-04T12:00:00.000Z",
      last_successful_index_at: null,
    });
  });

  it("represents stale synchronization without pretending it is fresh", () => {
    const stale = transitionProjectStatus(freshStatus(), {
      type: "sync_failed",
      cause: "source_change",
      error: "compiler refresh failed",
    });

    expect(projectStatusToProjection(stale)).toMatchObject({
      state: "stale",
      causes: ["source_change"],
      compiler: { state: "failed" },
      index: { state: "disabled" },
      degraded_errors: [],
    });

    const recovered = transitionProjectStatus(stale, {
      type: "sync_succeeded",
      sourceCount: 4,
      indexedCount: 4,
      sourceSnapshotFingerprint: sourceFingerprintV2,
      configSnapshotFingerprint: configFingerprintV2,
      at: "2026-08-04T12:01:00.000Z",
    });
    expect(projectStatusToProjection(recovered).state).toBe("fresh");
  });

  it("enters degraded state for index and watcher failures and bounds details", () => {
    const tooManyFiles = Array.from(
      { length: MAX_PENDING_FILES + 3 },
      (_, index) => `src/file-${index}.ts`,
    );
    const pending = transitionProjectStatus(freshStatus(), {
      type: "source_changed",
      files: tooManyFiles,
    });
    const degraded = transitionProjectStatus(pending, {
      type: "index_failed",
      error: "index unavailable at /home/yail/workspaces/example-project/.cache/index.json",
    });
    const withWatcherFailure = transitionProjectStatus(degraded, {
      type: "watcher_failed",
      error: String.raw`watcher unavailable at C:\Users\yail\workspaces\example-project\.cache\watcher.log`,
    });
    const projection = projectStatusToProjection(withWatcherFailure);

    expect(projection.state).toBe("degraded");
    expect(projection.causes).toEqual(["source_change", "index_failure", "watcher_failure"]);
    expect(projection.pending_files).toHaveLength(MAX_PENDING_FILES);
    expect(projection.pending_files_truncated).toBe(true);
    expect(projection.pending_files_truncation).toEqual({
      truncated: true,
      reason: "record_limit",
    });
    expect(projection.pending_files_filename_truncation).toEqual({
      truncated: false,
      reason: null,
    });
    expect(projection.degraded_errors).toEqual([
      "index unavailable at [path-redacted]",
      "watcher unavailable at [path-redacted]",
    ]);
    expect(projection.degraded_errors).toHaveLength(2);
    expect(projection.degraded_errors_truncation).toEqual({
      truncated: false,
      reason: null,
    });
    expect(projection.degraded_errors_text_truncation).toEqual({
      truncated: false,
      reason: null,
    });
    expect(JSON.stringify(projection.degraded_errors)).not.toContain("/home/yail");
    expect(JSON.stringify(projection.degraded_errors)).not.toContain("C:\\Users\\yail");
    expect(MAX_DEGRADED_ERRORS).toBeGreaterThan(2);
  });

  it("reports degraded-error count and text truncation with canonical metadata", () => {
    let countBounded = freshStatus();
    for (let index = 0; index < MAX_DEGRADED_ERRORS + 2; index += 1) {
      countBounded = transitionProjectStatus(countBounded, {
        type: "index_failed",
        error: `index failure ${index}`,
      });
    }

    const countProjection = projectStatusToProjection(countBounded);
    expect(countProjection.degraded_errors).toHaveLength(MAX_DEGRADED_ERRORS);
    expect(countProjection.degraded_errors_truncation).toEqual({
      truncated: true,
      reason: "record_limit",
    });
    expect(countProjection.degraded_errors_text_truncation).toEqual({
      truncated: false,
      reason: null,
    });

    const longProjection = projectStatusToProjection(
      transitionProjectStatus(freshStatus(), {
        type: "index_failed",
        error: "x".repeat(MAX_STATUS_TEXT_LENGTH + 1),
      }),
    );
    expect(longProjection.degraded_errors[0]).toMatch(/\.\.\. \[truncated\]$/);
    expect(longProjection.degraded_errors_truncation).toEqual({
      truncated: true,
      reason: "serialization_limit",
    });
    expect(longProjection.degraded_errors_text_truncation).toEqual({
      truncated: true,
      reason: "serialization_limit",
    });
  });

  it("bounds each normalized pending filename with separate serialization metadata", () => {
    const longRelativePath = `src/${"nested/".repeat(MAX_PENDING_FILENAME_LENGTH)}secret.ts`;
    const projection = projectStatusToProjection(
      transitionProjectStatus(freshStatus(), {
        type: "source_changed",
        files: [longRelativePath],
      }),
    );

    expect(projection.pending_files).toHaveLength(1);
    expect(projection.pending_files[0]).toHaveLength(MAX_PENDING_FILENAME_LENGTH);
    expect(projection.pending_files[0].length).toBeLessThanOrEqual(MAX_PENDING_FILENAME_LENGTH);
    expect(projection.pending_files_truncated).toBe(true);
    expect(projection.pending_files_truncation).toEqual({
      truncated: false,
      reason: null,
    });
    expect(projection.pending_files_filename_truncation).toEqual({
      truncated: true,
      reason: "serialization_limit",
    });
  });

  it("redacts traversal, UNC, and spaced absolute targets from degraded errors", () => {
    let status = freshStatus();
    for (const error of [
      "failed to read ../secret/target.ts: permission denied",
      String.raw`failed to open ..\secret\target.ts: permission denied`,
      "failed to read ../secret dir/target file.ts: permission denied",
      String.raw`failed to open ..\secret dir\target file.ts: permission denied`,
      "failed to resolve src/../outside dir/target file.ts: permission denied",
      String.raw`failed to watch src\..\outside dir\target file.ts: permission denied`,
      String.raw`watcher failed for \\server\share\secret\watcher.log: permission denied`,
      "failed at /home/yail/workspaces/My Project/secret file.ts: permission denied",
    ]) {
      status = transitionProjectStatus(status, { type: "index_failed", error });
    }

    const errors = projectStatusToProjection(status).degraded_errors;
    expect(errors).toEqual(
      expect.arrayContaining([
        "failed to read [path-redacted]: permission denied",
        "failed to open [path-redacted]: permission denied",
        "failed to resolve [path-redacted]: permission denied",
        "failed to watch [path-redacted]: permission denied",
        "watcher failed for [path-redacted]: permission denied",
        "failed at [path-redacted]: permission denied",
      ]),
    );
    expect(errors.join("\n")).not.toContain("../secret/target.ts");
    expect(errors.join("\n")).not.toContain(String.raw`..\secret\target.ts`);
    expect(errors.join("\n")).not.toContain("secret dir");
    expect(errors.join("\n")).not.toContain("outside dir");
    expect(errors.join("\n")).not.toContain("target file.ts");
    expect(errors.join("\n")).not.toContain("server");
    expect(errors.join("\n")).not.toContain("/home/yail");
    expect(errors.join("\n")).not.toContain("secret file.ts");
  });

  it("redacts root-level and absolute traversal paths before text truncation", () => {
    let status = freshStatus();
    const errors = [
      "failed to read /file.ts: permission denied",
      "failed to open C:\\file.ts: permission denied",
      "failed to resolve /My Project/../outside dir/target file.ts: permission denied",
      "failed to resolve C:\\foo\\..\\bar.ts: permission denied",
    ];

    for (const error of errors) {
      status = transitionProjectStatus(status, { type: "index_failed", error });
    }

    const projection = projectStatusToProjection(status);
    expect(projection.degraded_errors).toEqual([
      "failed to read [path-redacted]: permission denied",
      "failed to open [path-redacted]: permission denied",
      "failed to resolve [path-redacted]: permission denied",
    ]);
    expect(projection.degraded_errors.join("\\n")).toContain("permission denied");
    expect(projection.degraded_errors.join("\\n")).not.toContain("/file.ts");
    expect(projection.degraded_errors.join("\\n")).not.toContain(String.raw`C:\\file.ts`);
    expect(projection.degraded_errors.join("\\n")).not.toContain("My Project");
    expect(projection.degraded_errors.join("\\n")).not.toContain("outside dir");
    expect(projection.degraded_errors.join("\\n")).not.toContain("target file.ts");
    expect(projection.degraded_errors.join("\\n")).not.toContain(String.raw`C:\\foo`);
    expect(projection.degraded_errors.join("\\n")).not.toContain("bar.ts");

    const longPath = `/My Project/${"nested dir/".repeat(MAX_STATUS_TEXT_LENGTH)}../outside dir/target file.ts`;
    const longProjection = projectStatusToProjection(
      transitionProjectStatus(freshStatus(), {
        type: "index_failed",
        error: `failed to resolve ${longPath}: permission denied`,
      }),
    );
    expect(longProjection.degraded_errors).toEqual([
      "failed to resolve [path-redacted]: permission denied",
    ]);
    expect(longProjection.degraded_errors[0]).not.toMatch(/\.\.\. \[truncated\]$/);
  });

  it("redacts drive and UNC paths containing filename colons", () => {
    let status = freshStatus();
    for (const error of [
      String.raw`failed to read C:\Users\yail\secret:file.ts: permission denied`,
      String.raw`failed to read \\server\share\secret:file.ts: not found`,
    ]) {
      status = transitionProjectStatus(status, { type: "index_failed", error });
    }

    expect(projectStatusToProjection(status).degraded_errors).toEqual([
      "failed to read [path-redacted]: permission denied",
      "failed to read [path-redacted]: not found",
    ]);
  });

  it("redacts a drive path after generic diagnostic context without leaking markers", () => {
    const status = transitionProjectStatus(freshStatus(), {
      type: "index_failed",
      error: String.raw`failed C:\Users\yail\secret:file.ts: permission denied`,
    });

    expect(projectStatusToProjection(status).degraded_errors).toEqual([
      "failed [path-redacted]: permission denied",
    ]);
  });

  it("redacts quoted and multiline diagnostic paths before text truncation", () => {
    let status = freshStatus();
    for (const error of [
      'failed to open "/home/yail/My Project/file.ts": permission denied',
      String.raw`failed to open "C:\Users\yail\My Project\file.ts": permission denied`,
      String.raw`failed to resolve "C:\foo\..\bar file.ts": permission denied`,
      'failed to read "/home/yail/My Project/../outside dir/target file.ts": permission denied',
      'failed to read "../secret dir/target file.ts": permission denied',
      String.raw`failed to read "..\secret dir\target file.ts": permission denied`,
      "failed to resolve some dir/../outside dir/target.ts: permission denied",
      "failed to parse /home/yail/multiline.ts\npermission denied",
    ]) {
      status = transitionProjectStatus(status, { type: "index_failed", error });
    }

    const errors = projectStatusToProjection(status).degraded_errors;
    expect(errors).toEqual(
      expect.arrayContaining([
        'failed to open "[path-redacted]": permission denied',
        'failed to resolve "[path-redacted]": permission denied',
        'failed to read "[path-redacted]": permission denied',
        'failed to read "[path-redacted]": permission denied',
        "failed to resolve [path-redacted]: permission denied",
        "failed to parse [path-redacted]\npermission denied",
      ]),
    );
    const serialized = errors.join("\n");
    expect(serialized).not.toContain("/home/yail");
    expect(serialized).not.toContain("C:\\Users\\yail");
    expect(serialized).not.toContain("My Project");
    expect(serialized).not.toContain("outside dir");
    expect(serialized).not.toContain("bar file.ts");
    expect(serialized).toContain("permission denied");
  });

  it("redacts unquoted spaced traversal prefixes without losing diagnostic context", () => {
    let status = freshStatus();
    for (const error of [
      "diagnostic: some dir/../outside dir/target.ts: permission denied",
      String.raw`diagnostic: some dir\..\outside dir\target.ts: permission denied`,
      "diagnostic: some dir/../outside dir/target.ts\npermission denied",
      "notice some dir/../outside dir/target.ts. permission denied",
    ]) {
      status = transitionProjectStatus(status, { type: "index_failed", error });
    }

    const errors = projectStatusToProjection(status).degraded_errors;
    expect(errors).toEqual(
      expect.arrayContaining([
        "diagnostic: [path-redacted]: permission denied",
        "diagnostic: [path-redacted]\npermission denied",
        "notice [path-redacted]. permission denied",
      ]),
    );
    const serialized = errors.join("\n");
    expect(serialized).not.toContain("some dir");
    expect(serialized).not.toContain("outside dir");
    expect(serialized).toContain("diagnostic:");
    expect(serialized).toContain("permission denied");
  });

  it("preserves punctuation and diagnostic suffixes after redaction", () => {
    let status = freshStatus();
    for (const error of [
      "failed to read /home/yail/secret.ts): permission denied",
      String.raw`failed to read C:\Users\yail\secret.ts]: permission denied`,
      String.raw`failed to read \\\\server\share\secret.ts}. permission denied`,
      "failed to read ../outside/secret.ts. permission denied",
    ]) {
      status = transitionProjectStatus(status, { type: "index_failed", error });
    }

    expect(projectStatusToProjection(status).degraded_errors).toEqual(
      expect.arrayContaining([
        "failed to read [path-redacted]): permission denied",
        "failed to read [path-redacted]]: permission denied",
        "failed to read [path-redacted]}. permission denied",
        "failed to read [path-redacted]. permission denied",
      ]),
    );
  });

  it("normalizes externally supplied pending files and degraded errors at both boundaries", () => {
    const pendingFiles = [
      "/home/yail/external/secret.ts",
      '"/home/yail/quoted/secret.ts"',
      String.raw`"C:\Users\yail\quoted\secret.ts"`,
      String.raw`"\\server\share\quoted\secret.ts"`,
      `src/${"nested/".repeat(MAX_PENDING_FILENAME_LENGTH)}secret.ts`,
      ...Array.from({ length: MAX_PENDING_FILES }, (_, index) => `src/external-${index}.ts`),
    ];
    const degradedErrors = [
      "overflow error",
      ...Array.from({ length: MAX_DEGRADED_ERRORS - 2 }, (_, index) => `external error ${index}`),
      `long external error ${"x".repeat(MAX_STATUS_TEXT_LENGTH + 1)}`,
      "external error at /home/yail/external/secret.log",
    ];
    const external: ProjectStatus = {
      ...freshStatus(),
      pendingFiles,
      pendingFilesTruncated: false,
      pendingFilesTruncation: { truncated: false, reason: null },
      pendingFilesFilenameTruncation: { truncated: false, reason: null },
      degradedErrors,
      degradedErrorsTruncation: { truncated: false, reason: null },
      degradedErrorsTextTruncation: { truncated: false, reason: null },
    };

    for (const projection of [
      projectStatusToProjection(external),
      projectStatusToProjection(transitionProjectStatus(external, { type: "config_changed" })),
    ]) {
      expect(projection.pending_files).toHaveLength(MAX_PENDING_FILES);
      expect(projection.pending_files_truncated).toBe(true);
      expect(projection.pending_files_truncation).toEqual({
        truncated: true,
        reason: "record_limit",
      });
      expect(projection.pending_files_filename_truncation).toEqual({
        truncated: true,
        reason: "serialization_limit",
      });
      expect(projection.pending_files).toContain("[absolute-path-redacted]");
      expect(JSON.stringify(projection.pending_files)).not.toContain("/home/yail");
      expect(JSON.stringify(projection.pending_files)).not.toContain("C:/Users/yail");
      expect(JSON.stringify(projection.pending_files)).not.toContain("//server/share");

      expect(projection.degraded_errors).toHaveLength(MAX_DEGRADED_ERRORS);
      expect(projection.degraded_errors_truncation).toEqual({
        truncated: true,
        reason: "record_limit",
      });
      expect(projection.degraded_errors_text_truncation).toEqual({
        truncated: true,
        reason: "serialization_limit",
      });
      expect(projection.degraded_errors).toContain("external error at [path-redacted]");
      expect(JSON.stringify(projection.degraded_errors)).not.toContain("/home/yail");
    }
  });

  it("does not trust external fresh state when a component is failed", () => {
    for (const component of ["index", "watcher"] as const) {
      const external: ProjectStatus = {
        ...freshStatus(),
        state: "fresh",
        causes: [],
        index: { state: component === "index" ? "failed" : "disabled" },
        watcher: { state: component === "watcher" ? "failed" : "ready" },
      };

      const projected = projectStatusToProjection(external);
      expect(projected.state).toBe("degraded");
      expect(projected.causes).toContain(
        component === "index" ? "index_failure" : "watcher_failure",
      );
      expect(projected.last_successful_sync_at).toBe("2026-08-04T12:00:00.000Z");

      const blockedSync = transitionProjectStatus(external, {
        type: "sync_succeeded",
        sourceCount: 4,
        indexedCount: 4,
        sourceSnapshotFingerprint: sourceFingerprintV2,
        configSnapshotFingerprint: configFingerprintV2,
        at: "2026-08-04T12:01:00.000Z",
      });
      expect(projectStatusToProjection(blockedSync)).toMatchObject({
        state: "degraded",
        causes: expect.arrayContaining([
          component === "index" ? "index_failure" : "watcher_failure",
        ]),
        last_successful_sync_at: "2026-08-04T12:00:00.000Z",
      });
    }
  });

  it("does not trust externally injected fresh state without synchronization evidence", () => {
    const initial = createInitialProjectStatus(identity, { sourceCount: 4 });
    const external = { ...initial, state: "fresh" } as ProjectStatus;

    expect(projectStatusToProjection(external)).toMatchObject({
      state: "pending",
      last_successful_sync_at: null,
      source_snapshot_fingerprint: null,
      config_snapshot_fingerprint: null,
      canonical_snapshot_fingerprint: null,
    });

    const invalidated = {
      ...freshStatus(),
      state: "fresh",
      causes: ["source_change"],
    } as ProjectStatus;
    expect(projectStatusToProjection(invalidated).state).toBe("pending");

    const incompleteSync = transitionProjectStatus(initial, {
      type: "sync_succeeded",
      sourceCount: 4,
      indexedCount: 4,
      sourceSnapshotFingerprint: sourceFingerprintV1,
      at: "2026-08-04T12:00:00.000Z",
    });
    expect(projectStatusToProjection(incompleteSync).state).toBe("pending");
  });

  it("does not trust externally injected fresh state when the compiler failed", () => {
    const external = {
      ...freshStatus(),
      state: "fresh",
      causes: [],
      compiler: { state: "failed" },
    } as ProjectStatus;

    expect(projectStatusToProjection(external)).toMatchObject({
      state: "degraded",
      compiler: { state: "failed" },
      last_successful_sync_at: "2026-08-04T12:00:00.000Z",
    });
  });

  it("normalizes malformed synchronization metadata without claiming freshness", () => {
    const malformed = {
      ...createInitialProjectStatus(identity),
      state: "fresh",
      sourceCount: Number.NaN,
      lastSuccessfulSyncAt: 42,
      sourceSnapshotFingerprint: "/home/yail/source-fingerprint",
      configSnapshotFingerprint: String.raw`C:\Users\yail\config-fingerprint`,
      canonicalSnapshotFingerprint: null,
    } as unknown as ProjectStatus;
    const projection = projectStatusToProjection(malformed);

    expect(projection).toMatchObject({
      state: "degraded",
      source_count: 0,
      last_successful_sync_at: null,
    });
    expect(projection.source_snapshot_fingerprint).not.toContain("/home/yail");
    expect(projection.config_snapshot_fingerprint).not.toContain("C:\\Users\\yail");
    expect(isJsonValue(projection)).toBe(true);

    const invalidEventMetadata = transitionProjectStatus(createInitialProjectStatus(identity), {
      type: "sync_succeeded",
      sourceCount: 4,
      indexedCount: 4,
      sourceSnapshotFingerprint: 42 as unknown as string,
      configSnapshotFingerprint: { value: "invalid" } as unknown as string,
      at: 42 as unknown as string,
    });
    expect(invalidEventMetadata.state).toBe("pending");
    expect(projectStatusToProjection(invalidEventMetadata)).toMatchObject({
      state: "pending",
      last_successful_sync_at: null,
      source_snapshot_fingerprint: null,
      config_snapshot_fingerprint: null,
    });

    const driveRelativeFingerprint = {
      ...freshStatus(),
      sourceSnapshotFingerprint: "C:relative.ts",
      configSnapshotFingerprint: configFingerprintV2,
    } as ProjectStatus;
    const driveProjection = projectStatusToProjection(driveRelativeFingerprint);
    expect(driveProjection.state).toBe("fresh");
    expect(driveProjection.source_snapshot_fingerprint).not.toBe("C:relative.ts");
    expect(JSON.stringify(driveProjection)).not.toContain("C:relative.ts");

    const impossibleTimestamp = {
      ...freshStatus(),
      lastSuccessfulSyncAt: "2026-99-99T99:99:99Z",
    } as ProjectStatus;
    expect(projectStatusToProjection(impossibleTimestamp).state).toBe("pending");

    const impossibleEventTimestamp = transitionProjectStatus(createInitialProjectStatus(identity), {
      type: "sync_succeeded",
      sourceCount: 4,
      indexedCount: 4,
      sourceSnapshotFingerprint: sourceFingerprintV2,
      configSnapshotFingerprint: configFingerprintV2,
      at: "2026-02-30T12:00:00.000Z",
    });
    expect(impossibleEventTimestamp.state).toBe("pending");
  });

  it("normalizes field-specific truncation reasons at the projection boundary", () => {
    const external = {
      ...freshStatus(),
      pendingFilesTruncation: { truncated: true, reason: "serialization_limit" },
      pendingFilesFilenameTruncation: { truncated: true, reason: "record_limit" },
      degradedErrorsTruncation: { truncated: true, reason: "serialization_limit" },
      degradedErrorsTextTruncation: { truncated: true, reason: "record_limit" },
    } as unknown as ProjectStatus;

    expect(projectStatusToProjection(external)).toMatchObject({
      pending_files_truncation: { truncated: true, reason: "record_limit" },
      pending_files_filename_truncation: { truncated: true, reason: "serialization_limit" },
      degraded_errors_truncation: { truncated: true, reason: "serialization_limit" },
      degraded_errors_text_truncation: { truncated: true, reason: "serialization_limit" },
    });
  });

  it("fails closed for non-finite counts in external statuses and sync events", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1.5]) {
      for (const field of ["sourceCount", "indexedCount"] as const) {
        const external = { ...freshStatus(), [field]: value } as unknown as ProjectStatus;
        const projection = projectStatusToProjection(external);
        expect(projection.state).toBe("degraded");
        expect(projection.source_count).toBe(field === "sourceCount" ? 0 : 4);
        expect(projection.last_successful_sync_at).toBe("2026-08-04T12:00:00.000Z");
      }

      const transitioned = transitionProjectStatus(freshStatus(), {
        type: "sync_succeeded",
        sourceCount: value,
        indexedCount: 4,
        sourceSnapshotFingerprint: sourceFingerprintV2,
        configSnapshotFingerprint: configFingerprintV2,
        at: "2026-08-04T12:01:00.000Z",
      } as never);
      expect(projectStatusToProjection(transitioned)).toMatchObject({
        state: "degraded",
        last_successful_sync_at: "2026-08-04T12:00:00.000Z",
        degraded_errors: ["[invalid-count]"],
      });

      const invalidIndexedCount = transitionProjectStatus(freshStatus(), {
        type: "sync_succeeded",
        sourceCount: 4,
        indexedCount: value,
        sourceSnapshotFingerprint: sourceFingerprintV2,
        configSnapshotFingerprint: configFingerprintV2,
        at: "2026-08-04T12:01:00.000Z",
      } as never);
      expect(projectStatusToProjection(invalidIndexedCount).state).toBe("degraded");
    }
  });

  it("bounds and deduplicates hostile causes at both status boundaries", () => {
    const causes = new Array(100_000) as unknown[];
    causes.fill("source_change");
    const external = { ...freshStatus(), causes } as unknown as ProjectStatus;
    const projected = projectStatusToProjection(external);
    const transitioned = projectStatusToProjection(
      transitionProjectStatus(external, { type: "config_changed" }),
    );

    expect(projected.causes).toEqual(["source_change"]);
    for (const projection of [projected, transitioned]) {
      expect(new Set(projection.causes).size).toBe(projection.causes.length);
      expect(projection.causes.length).toBeLessThanOrEqual(5);
    }
    expect(transitioned.causes).toEqual(["source_change", "config_change"]);
  });

  it("fails closed for malformed or inconsistent external collections", () => {
    const malformedPending = {
      ...freshStatus(),
      pendingFiles: "src/not-an-array.ts",
    } as unknown as ProjectStatus;
    const missingErrors = {
      ...freshStatus(),
      degradedErrors: undefined,
    } as unknown as ProjectStatus;
    const pendingEvidence = { ...freshStatus(), pendingFiles: ["src/pending.ts"] };

    expect(projectStatusToProjection(malformedPending).state).toBe("degraded");
    expect(projectStatusToProjection(missingErrors).state).toBe("degraded");
    expect(projectStatusToProjection(pendingEvidence).state).toBe("pending");

    const attemptedRecovery = projectStatusToProjection(
      transitionProjectStatus(malformedPending, {
        type: "sync_succeeded",
        sourceCount: 4,
        indexedCount: 4,
        sourceSnapshotFingerprint: sourceFingerprintV2,
        configSnapshotFingerprint: configFingerprintV2,
        at: "2026-08-05T12:00:00.000Z",
      }),
    );
    expect(attemptedRecovery).toMatchObject({
      state: "degraded",
      last_successful_sync_at: "2026-08-04T12:00:00.000Z",
    });
  });

  it("rejects sparse and custom causes at the projection boundary", () => {
    const sparseCauses = new Array(1) as unknown[];
    const customCauses = new (class CustomCauses extends Array<string> {})("source_change");

    for (const causes of [sparseCauses, customCauses]) {
      const projection = projectStatusToProjection({ ...freshStatus(), causes } as ProjectStatus);
      expect(projection.state).toBe("degraded");
      expect(isJsonValue(projection)).toBe(true);
    }
  });

  it("does not preserve externally injected fresh while the compiler is rebuilding", () => {
    const external = {
      ...freshStatus(),
      compiler: { state: "rebuilding" },
    } as ProjectStatus;

    expect(projectStatusToProjection(external).state).toBe("pending");
  });

  it("preserves invalidation evidence when complete sync metadata has an invalid timestamp", () => {
    const stale = transitionProjectStatus(freshStatus(), {
      type: "source_changed",
      files: ["src/changed.ts"],
    });
    const invalidTimestamp = transitionProjectStatus(stale, {
      type: "sync_succeeded",
      sourceCount: 4,
      indexedCount: 4,
      sourceSnapshotFingerprint: sourceFingerprintV2,
      configSnapshotFingerprint: configFingerprintV2,
      at: "2026-02-30T12:00:00.000Z",
    });
    expect(projectStatusToProjection(invalidTimestamp)).toMatchObject({
      state: "pending",
      causes: ["source_change"],
      pending_files: ["src/changed.ts"],
      last_successful_sync_at: "2026-08-04T12:00:00.000Z",
    });
  });

  it("caps hostile pending-file collection work before normalization", () => {
    const hostile = Array.from({ length: 1_000 }, (_, index) => `src/file-${index}.ts`);
    const pending = projectStatusToProjection(
      transitionProjectStatus(freshStatus(), {
        type: "source_changed",
        files: hostile,
      }),
    );

    expect(pending.pending_files[0]).toBe("src/file-0.ts");
    expect(pending.pending_files.length).toBe(64);
    expect(pending.pending_files_truncation).toEqual({ truncated: true, reason: "record_limit" });
  });

  it("fails closed for unknown and malformed transition events", () => {
    for (const event of [
      null,
      { type: "unknown" },
      { type: "sync_failed", cause: "unknown", error: "bad cause" },
      { type: "stale_detected", cause: "unknown" },
    ]) {
      const transitioned = transitionProjectStatus(freshStatus(), event as never);
      const projection = projectStatusToProjection(transitioned);
      expect(projection.state).toBe("degraded");
      expect(
        projection.causes.every((cause) =>
          [
            "source_change",
            "config_change",
            "index_failure",
            "watcher_failure",
            "compiler_rebuild",
          ].includes(cause),
        ),
      ).toBe(true);
      expect(isJsonValue(projection)).toBe(true);
    }
  });

  it("does not clear a watcher failure for an invalid recovery component", () => {
    const failed = transitionProjectStatus(freshStatus(), {
      type: "watcher_failed",
      error: "watcher unavailable",
    });
    const recovered = transitionProjectStatus(failed, {
      type: "component_recovered",
      component: "other",
    } as never);

    expect(projectStatusToProjection(recovered)).toMatchObject({
      state: "degraded",
      causes: expect.arrayContaining(["watcher_failure"]),
      watcher: { state: "failed" },
    });
  });

  it("keeps malformed component states boundary-invalid through recovery", () => {
    for (const component of ["index", "watcher"] as const) {
      const malformed = {
        ...freshStatus(),
        [component]: { state: "bogus" },
      } as unknown as ProjectStatus;
      const recovered = transitionProjectStatus(malformed, {
        type: component === "index" ? "index_recovered" : "watcher_recovered",
      });
      const projection = projectStatusToProjection(recovered);

      expect(projection.state).toBe("degraded");
      expect(recovered.boundaryInvalid).toBe(true);
      expect(projection.causes).not.toContain(`${component}_failure`);
    }
  });

  it("redacts the complete POSIX filename when the filename contains a colon", () => {
    const failed = transitionProjectStatus(freshStatus(), {
      type: "watcher_failed",
      error: "failed to read /home/yail/secret:file.ts: permission denied",
    });

    expect(projectStatusToProjection(failed).degraded_errors).toEqual([
      "failed to read [path-redacted]: permission denied",
    ]);
  });

  it("fails closed for null and primitive status inputs", () => {
    const nullProjection = projectStatusToProjection(null as unknown as ProjectStatus);
    const primitiveProjection = projectStatusToProjection("invalid" as unknown as ProjectStatus);
    const transitioned = transitionProjectStatus(null as unknown as ProjectStatus, null as never);

    for (const projection of [
      nullProjection,
      primitiveProjection,
      projectStatusToProjection(transitioned),
    ]) {
      expect(projection).toMatchObject({
        state: "degraded",
        source_count: 0,
        indexed_count: 0,
        last_successful_sync_at: null,
      });
      expect(projection.degraded_errors).toContain("[invalid-status]");
      expect(isJsonValue(projection)).toBe(true);
    }
  });

  it("keeps a cause-only watcher failure active through complete sync", () => {
    const external: ProjectStatus = {
      ...freshStatus(),
      state: "fresh",
      causes: ["watcher_failure"],
      watcher: { state: "ready" },
    };

    const blockedSync = transitionProjectStatus(external, {
      type: "sync_succeeded",
      sourceCount: 4,
      indexedCount: 4,
      sourceSnapshotFingerprint: sourceFingerprintV2,
      configSnapshotFingerprint: configFingerprintV2,
      at: "2026-08-04T12:01:00.000Z",
    });
    expect(projectStatusToProjection(blockedSync)).toMatchObject({
      state: "degraded",
      causes: ["watcher_failure"],
      last_successful_sync_at: "2026-08-04T12:00:00.000Z",
    });

    const recovered = transitionProjectStatus(blockedSync, {
      type: "watcher_recovered",
    });
    const fresh = transitionProjectStatus(recovered, {
      type: "sync_succeeded",
      sourceCount: 4,
      indexedCount: 4,
      sourceSnapshotFingerprint: sourceFingerprintV3,
      configSnapshotFingerprint: configFingerprintV3,
      at: "2026-08-04T12:02:00.000Z",
    });
    expect(projectStatusToProjection(fresh)).toMatchObject({
      state: "fresh",
      causes: [],
      last_successful_sync_at: "2026-08-04T12:02:00.000Z",
    });
  });

  it("fails closed for malformed external states and causes", () => {
    const malformed = {
      ...freshStatus(),
      state: "bogus",
      causes: ["not-a-cause"],
      compiler: { state: "bogus" },
      index: { state: "bogus" },
      watcher: { state: "bogus" },
    } as unknown as ProjectStatus;

    const projection = projectStatusToProjection(malformed);
    expect(projection.state).toBe("degraded");
    expect(projection.causes).toEqual(["index_failure", "watcher_failure"]);
    expect(projection.compiler).toEqual({ state: "failed" });
    expect(projection.index).toEqual({ state: "failed" });
    expect(projection.watcher).toEqual({ state: "failed" });
    expect((projection.causes as readonly string[]).includes("not-a-cause")).toBe(false);
  });

  it("fails closed when externally supplied causes are not arrays", () => {
    for (const causes of [null, "watcher_failure"]) {
      const malformed = {
        ...freshStatus(),
        state: "fresh",
        causes,
      } as unknown as ProjectStatus;

      const projection = projectStatusToProjection(malformed);
      expect(projection.state).toBe("degraded");
      expect(projection.causes).toEqual([]);
      expect(projection.last_successful_sync_at).toBe("2026-08-04T12:00:00.000Z");

      const blocked = transitionProjectStatus(malformed, {
        type: "sync_succeeded",
        sourceCount: 4,
        indexedCount: 4,
        sourceSnapshotFingerprint: sourceFingerprintV2,
        configSnapshotFingerprint: configFingerprintV2,
        at: "2026-08-04T12:01:00.000Z",
      });
      expect(projectStatusToProjection(blocked)).toMatchObject({
        state: "degraded",
        causes: [],
        last_successful_sync_at: "2026-08-04T12:00:00.000Z",
      });
    }
  });

  it("sanitizes externally supplied project identity and truncation metadata", () => {
    const external = {
      ...freshStatus(),
      project: {
        project_id: "/home/yail/leak",
        config_id: String.raw`C:\Users\yail\secret`,
      },
      pendingFiles: undefined,
      degradedErrors: undefined,
      pendingFilesTruncation: { truncated: true, reason: "not-a-reason" },
      degradedErrorsTruncation: { truncated: true, reason: "not-a-reason" },
    } as unknown as ProjectStatus;

    const projection = projectStatusToProjection(external);
    expect(projection.project).not.toEqual(external.project);
    expect(JSON.stringify(projection.project)).not.toContain("/home/yail");
    expect(JSON.stringify(projection.project)).not.toContain("C:\\Users\\yail");
    expect(projection.pending_files).toEqual([]);
    expect(projection.degraded_errors).toEqual([]);
    expect(projection.pending_files_truncation).toEqual({
      truncated: true,
      reason: "record_limit",
    });
    expect(projection.degraded_errors_truncation).toEqual({
      truncated: true,
      reason: "record_limit",
    });
  });

  it("ignores malformed event collections without spreading or leaking their values", () => {
    const malformedFiles = String.raw`/home/yail/leak` as unknown as readonly string[];
    const mixedFiles = ["src/value.ts", "/home/yail/secret.ts", 42] as unknown as readonly string[];

    const fromString = projectStatusToProjection(
      transitionProjectStatus(freshStatus(), { type: "source_changed", files: malformedFiles }),
    );
    const fromMixed = projectStatusToProjection(
      transitionProjectStatus(freshStatus(), { type: "stale_detected", files: mixedFiles }),
    );

    expect(fromString.pending_files).toEqual([]);
    expect(fromMixed.pending_files).toEqual([]);
    expect(fromString.state).toBe("degraded");
    expect(fromMixed.state).toBe("degraded");
    expect(fromString.degraded_errors).toEqual(["[invalid-files]"]);
    expect(fromMixed.degraded_errors).toEqual(["[invalid-files]"]);
    expect(JSON.stringify(fromString.pending_files)).not.toContain("home");
    expect(JSON.stringify(fromMixed.pending_files)).not.toContain("/home/yail");

    const invalidError = transitionProjectStatus(freshStatus(), {
      type: "index_failed",
      error: 42 as unknown as string,
    });
    expect(projectStatusToProjection(invalidError).degraded_errors).toEqual(["[invalid-error]"]);
  });

  it("normalizes a failed watcher in the initial constructor", () => {
    const projection = projectStatusToProjection(
      createInitialProjectStatus(identity, { watcherState: "failed" }),
    );

    expect(projection).toMatchObject({
      state: "degraded",
      causes: ["watcher_failure"],
      watcher: { state: "failed" },
    });
  });

  it("redacts absolute and traversal paths from pending files", () => {
    const pending = transitionProjectStatus(freshStatus(), {
      type: "source_changed",
      files: [
        "./src/value.ts",
        "src/../outside.ts",
        "/home/yail/workspaces/example-project/secret.ts",
        String.raw`C:\Users\yail\workspaces\example-project\secret.ts`,
      ],
    });

    expect(projectStatusToProjection(pending).pending_files).toEqual([
      "src/value.ts",
      "[path-redacted]",
      "[absolute-path-redacted]",
    ]);
    expect(JSON.stringify(projectStatusToProjection(pending).pending_files)).not.toContain(
      "outside.ts",
    );
    expect(JSON.stringify(projectStatusToProjection(pending).pending_files)).not.toContain(
      "C:/Users/yail",
    );
  });

  it("redacts drive-relative paths from pending files", () => {
    const pending = transitionProjectStatus(freshStatus(), {
      type: "source_changed",
      files: ["C:relative.ts", "C:relative\\file.ts"],
    });

    expect(projectStatusToProjection(pending).pending_files).toEqual(["[absolute-path-redacted]"]);
    expect(JSON.stringify(projectStatusToProjection(pending).pending_files)).not.toContain(
      "C:relative",
    );
  });

  it("recovers a failed index to ready until a fresh synchronization", () => {
    const degraded = transitionProjectStatus(freshStatus(), {
      type: "index_failed",
      error: "index unavailable",
    });
    const recovered = transitionProjectStatus(degraded, {
      type: "index_recovered",
    });

    expect(projectStatusToProjection(recovered)).toMatchObject({
      state: "pending",
      causes: [],
      indexed_count: 0,
      index: { state: "ready" },
      last_successful_index_at: null,
    });
  });

  it("recovers components without claiming fresh until synchronization succeeds", () => {
    const degraded = transitionProjectStatus(freshStatus(), {
      type: "watcher_failed",
      error: "watcher unavailable",
    });
    const recovered = transitionProjectStatus(degraded, {
      type: "component_recovered",
      component: "watcher",
    });

    expect(projectStatusToProjection(recovered)).toMatchObject({
      state: "pending",
      causes: [],
      watcher: { state: "ready" },
    });
  });

  it("uses a deterministic redacted identity instead of host paths", () => {
    const sameIdentity = createProjectIdentity({
      projectRoot: "/home/yail/workspaces/example-project",
      configPath: "/home/yail/workspaces/example-project/tsconfig.json",
    });
    const projection = projectStatusToProjection(freshStatus());
    const serialized = JSON.stringify(projection.project);

    expect(sameIdentity).toEqual(identity);
    expect(serialized).not.toContain("/home/yail");
    expect(serialized).not.toContain("example-project");
    expect(projection.project).toEqual({
      project_id: identity.project_id,
      config_id: identity.config_id,
    });
    expect(isJsonValue(projection)).toBe(true);
  });
});
