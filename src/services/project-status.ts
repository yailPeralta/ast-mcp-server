import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import {
  MAX_PROJECT_OPERATION_COUNTER,
  MAX_PROJECT_OPERATION_DURATION_MS,
  type ProjectOperationAdmission,
  type ProjectOperationOutcome,
} from "./project-operation-scheduler.js";
import { sanitizeSensitiveText } from "./public-errors.js";
import {
  createTruncationMetadata,
  isFreshnessCause,
  isSnapshotState,
  isTruncationReason,
  type FreshnessCause,
  type SnapshotState,
  type TruncationReason,
  type TruncationMetadata,
} from "./read-contracts.js";

export const MAX_PENDING_FILES = 64;
export const MAX_PENDING_FILENAME_LENGTH = 256;
export const MAX_DEGRADED_ERRORS = 8;
export const MAX_STATUS_TEXT_LENGTH = 512;
const TRUNCATION_SUFFIX = "... [truncated]";
const MAX_STATUS_CAUSES = 5;
const MAX_PENDING_INPUT_SCAN = MAX_PENDING_FILES * 4;
const MAX_ERROR_INPUT_SCAN = MAX_DEGRADED_ERRORS * 4;

export type ProjectStatusState = SnapshotState;

export type ProjectStatusCause = FreshnessCause;
export type SynchronizationCause = Exclude<FreshnessCause, "index_failure" | "watcher_failure">;

export type CompilerStatusState = "ready" | "rebuilding" | "failed";
export type IndexStatusState = "disabled" | "ready" | "rebuilding" | "failed";
export type WatcherStatusState = "disabled" | "ready" | "failed";

function isCompilerStatusState(value: unknown): value is CompilerStatusState {
  return value === "ready" || value === "rebuilding" || value === "failed";
}

function isIndexStatusState(value: unknown): value is IndexStatusState {
  return value === "disabled" || value === "ready" || value === "rebuilding" || value === "failed";
}

function isWatcherStatusState(value: unknown): value is WatcherStatusState {
  return value === "disabled" || value === "ready" || value === "failed";
}

function isSynchronizationCause(value: unknown): value is SynchronizationCause {
  return value === "source_change" || value === "config_change" || value === "compiler_rebuild";
}

export interface ProjectIdentityInput {
  projectRoot: string;
  configPath?: string;
}

/**
 * The public project identity deliberately contains digests, not filesystem paths.
 * The full paths are accepted only to make the digest stable for a project session.
 */
export interface ProjectIdentity {
  readonly project_id: string;
  readonly config_id: string | null;
}

export interface ProjectStatusComponent<TState extends string> {
  readonly state: TState;
}

export interface ProjectStatus {
  readonly project: ProjectIdentity;
  readonly state: ProjectStatusState;
  readonly causes: readonly ProjectStatusCause[];
  readonly sourceCount: number;
  readonly indexedCount: number;
  readonly pendingFiles: readonly string[];
  readonly pendingFilesTruncated: boolean;
  readonly pendingFilesTruncation: TruncationMetadata;
  readonly pendingFilesFilenameTruncation: TruncationMetadata;
  readonly compiler: ProjectStatusComponent<CompilerStatusState>;
  readonly index: ProjectStatusComponent<IndexStatusState>;
  readonly watcher: ProjectStatusComponent<WatcherStatusState>;
  readonly lastSuccessfulSyncAt: string | null;
  readonly lastSuccessfulIndexAt: string | null;
  readonly sourceSnapshotFingerprint: string | null;
  readonly configSnapshotFingerprint: string | null;
  readonly canonicalSnapshotFingerprint: string | null;
  readonly degradedErrors: readonly string[];
  readonly degradedErrorsTruncation: TruncationMetadata;
  readonly degradedErrorsTextTruncation: TruncationMetadata;
  readonly boundaryInvalid?: boolean;
}

export interface CreateProjectStatusOptions {
  sourceCount?: number;
  indexedCount?: number;
  pendingFiles?: readonly string[];
  watcherState?: WatcherStatusState;
}

export type ProjectStatusEvent =
  | {
      type: "source_changed";
      files?: readonly string[];
    }
  | {
      type: "config_changed";
    }
  | {
      type: "compiler_rebuild_started";
    }
  | {
      type: "sync_succeeded";
      sourceCount: number;
      indexedCount: number;
      sourceSnapshotFingerprint?: string;
      configSnapshotFingerprint?: string;
      canonicalSnapshotFingerprint?: string;
      at?: string;
    }
  | {
      type: "sync_failed";
      cause: SynchronizationCause;
      error: string;
    }
  | {
      type: "stale_detected";
      cause?: SynchronizationCause;
      files?: readonly string[];
    }
  | {
      type: "index_failed";
      error: string;
    }
  | {
      type: "watcher_failed";
      error: string;
    }
  | {
      type: "component_recovered";
      component: "index" | "watcher";
    }
  | {
      type: "index_recovered";
    }
  | {
      type: "index_ready";
    }
  | {
      type: "index_disabled";
    }
  | {
      type: "watcher_recovered";
    };

export interface ProjectStatusProjection {
  readonly project: ProjectIdentity;
  readonly state: ProjectStatusState;
  readonly causes: readonly ProjectStatusCause[];
  readonly source_count: number;
  readonly indexed_count: number;
  readonly pending_files: readonly string[];
  readonly pending_files_truncated: boolean;
  readonly pending_files_truncation: TruncationMetadata;
  readonly pending_files_filename_truncation: TruncationMetadata;
  readonly compiler: ProjectStatusComponent<CompilerStatusState>;
  readonly index: ProjectStatusComponent<IndexStatusState>;
  readonly watcher: ProjectStatusComponent<WatcherStatusState>;
  readonly last_successful_sync_at: string | null;
  readonly last_successful_index_at: string | null;
  readonly source_snapshot_fingerprint: string | null;
  readonly config_snapshot_fingerprint: string | null;
  readonly canonical_snapshot_fingerprint: string | null;
  readonly degraded_errors: readonly string[];
  readonly degraded_errors_truncation: TruncationMetadata;
  readonly degraded_errors_text_truncation: TruncationMetadata;
}

export type ProjectQueueState = "idle" | "queued" | "running";

export interface ProjectOperationQueueProjection {
  readonly state: ProjectQueueState;
  readonly admission: ProjectOperationAdmission;
  readonly queue_capacity: number;
  readonly active_operations: number;
  readonly queued_operations: number;
  readonly rejected_operations: number;
  readonly cancelled_operations: number;
  readonly queue_timeout_operations: number;
  readonly deadline_exceeded_operations: number;
  readonly last_outcome: ProjectOperationOutcome;
  readonly max_queue_wait_ms: number;
  readonly max_execution_ms: number;
}

function canonicalIdentityPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  const hasLeadingSlash = normalized.startsWith("/");
  const windowsDrive = /^[A-Za-z]:\//.test(normalized);
  const segments = normalized.split("/");
  const result: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === ".." && result.length > 0 && result[result.length - 1] !== "..") {
      result.pop();
      continue;
    }
    result.push(segment);
  }

  const joined = result.join("/");
  if (hasLeadingSlash) return `/${joined}`;
  if (windowsDrive) return joined;
  return joined || ".";
}

function digest(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 20)}`;
}

function fingerprintDigest(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function normalizeIdentityToken(value: unknown, prefix: "project" | "config"): string {
  const expected = new RegExp(`^${prefix}_[0-9a-f]{20}$`);
  return typeof value === "string" && expected.test(value) ? value : digest(prefix, "[redacted]");
}

function normalizeProjectIdentity(value: unknown): ProjectIdentity {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  return {
    project_id: normalizeIdentityToken(record.project_id, "project"),
    config_id:
      record.config_id === null || record.config_id === undefined
        ? null
        : normalizeIdentityToken(record.config_id, "config"),
  };
}

export function createProjectIdentity(input: ProjectIdentityInput): ProjectIdentity {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.projectRoot !== "string" ||
    (input.configPath !== undefined && typeof input.configPath !== "string")
  ) {
    throw new Error("Project identity input must contain string paths.");
  }
  const projectRoot = canonicalIdentityPath(input.projectRoot);
  const configPath =
    input.configPath === undefined ? null : canonicalIdentityPath(input.configPath);

  return {
    project_id: digest("project", projectRoot),
    config_id: configPath === null ? null : digest("config", configPath),
  };
}

function isFiniteCount(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

function boundedCount(value: number | undefined): number {
  if (!isFiniteCount(value)) return 0;
  return value;
}

const MAX_STATUS_TEXT_INPUT_CHARS = 8192;

function boundedText(value: unknown): { value: string; truncated: boolean } {
  const text = typeof value === "string" ? value : "[invalid-error]";
  const inputTruncated = text.length > MAX_STATUS_TEXT_INPUT_CHARS;
  const redacted = sanitizeSensitiveText(text.slice(0, MAX_STATUS_TEXT_INPUT_CHARS));
  return !inputTruncated && redacted.length <= MAX_STATUS_TEXT_LENGTH
    ? { value: redacted, truncated: false }
    : {
        value: `${redacted.slice(0, MAX_STATUS_TEXT_LENGTH - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`,
        truncated: true,
      };
}

function projectRelativePath(value: string): string {
  let normalized = value.trim().replaceAll("\\", "/");
  const quote = normalized[0];
  if (
    normalized.length >= 2 &&
    (quote === '"' || quote === "'" || quote === "`") &&
    normalized.endsWith(quote)
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    return "[absolute-path-redacted]";
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    return "[path-redacted]";
  }
  return segments.filter((segment) => segment.length > 0 && segment !== ".").join("/") || ".";
}

interface ArrayShape {
  readonly valid: boolean;
  readonly truncated: boolean;
}

function validateArrayShape(value: unknown, limit: number): ArrayShape {
  if (!Array.isArray(value)) return { valid: false, truncated: false };
  if (Object.getPrototypeOf(value) !== Array.prototype) return { valid: false, truncated: false };
  if (Object.getOwnPropertySymbols(value).length > 0) return { valid: false, truncated: false };
  const end = Math.min(value.length, limit);
  for (let index = 0; index < end; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string"
    ) {
      return { valid: false, truncated: value.length > end };
    }
  }
  return { valid: true, truncated: value.length > end };
}

interface StringCollectionPrefix {
  readonly values: readonly string[];
  readonly valid: boolean;
  readonly truncated: boolean;
}

function collectStringPrefix(value: unknown, limit: number): StringCollectionPrefix {
  const shape = validateArrayShape(value, limit);
  if (!Array.isArray(value)) return { values: [], ...shape };
  const end = Math.min(value.length, limit);
  const values: string[] = [];
  for (let index = 0; index < end; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string") {
      values.push(descriptor.value);
    }
  }
  return { values, ...shape };
}

interface PendingFilesBounds {
  readonly files: readonly string[];
  readonly recordTruncation: TruncationMetadata;
  readonly filenameTruncation: TruncationMetadata;
}

function boundedPendingFilename(value: string): { value: string; truncated: boolean } {
  if (value.length <= MAX_PENDING_FILENAME_LENGTH) {
    return { value, truncated: false };
  }
  return {
    value: `${value.slice(0, MAX_PENDING_FILENAME_LENGTH - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`,
    truncated: true,
  };
}

function boundedPendingFiles(files: unknown): PendingFilesBounds {
  const collected = collectStringPrefix(files, MAX_PENDING_INPUT_SCAN);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const file of collected.values) {
    const normalized = projectRelativePath(file);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
    if (unique.length > MAX_PENDING_FILES) break;
  }
  const bounded = unique.slice(0, MAX_PENDING_FILES).map(boundedPendingFilename);
  const recordTruncated = collected.truncated || unique.length > MAX_PENDING_FILES;
  const filenameTruncated = bounded.some((file) => file.truncated);
  return {
    files: bounded.slice(0, MAX_PENDING_FILES).map((file) => file.value),
    recordTruncation: createTruncationMetadata(
      recordTruncated,
      recordTruncated ? "record_limit" : null,
    ),
    filenameTruncation: createTruncationMetadata(
      filenameTruncated,
      filenameTruncated ? "serialization_limit" : null,
    ),
  };
}

function mergePendingFiles(current: unknown, incoming: unknown): PendingFilesBounds {
  const currentPrefix = collectStringPrefix(current, MAX_PENDING_INPUT_SCAN);
  const incomingPrefix = collectStringPrefix(incoming, MAX_PENDING_INPUT_SCAN);
  const merged = boundedPendingFiles([...currentPrefix.values, ...incomingPrefix.values]);
  const recordTruncated =
    merged.recordTruncation.truncated || currentPrefix.truncated || incomingPrefix.truncated;
  return {
    ...merged,
    recordTruncation: createTruncationMetadata(
      recordTruncated,
      recordTruncated ? "record_limit" : null,
    ),
  };
}

function appendCause(
  current: readonly ProjectStatusCause[],
  cause: ProjectStatusCause,
): readonly ProjectStatusCause[] {
  if (current.includes(cause)) return current;
  if (current.length >= MAX_STATUS_CAUSES) return current;
  return [...current, cause];
}

function removeCause(
  current: readonly ProjectStatusCause[],
  cause: ProjectStatusCause,
): readonly ProjectStatusCause[] {
  return current.filter((currentCause) => currentCause !== cause);
}

function appendError(
  current: unknown,
  error: unknown,
): {
  errors: readonly string[];
  countTruncated: boolean;
  textTruncated: boolean;
} {
  const bounded = boundedText(error);
  const currentErrors = collectStringPrefix(current, MAX_DEGRADED_ERRORS).values;
  const next = currentErrors.includes(bounded.value)
    ? currentErrors
    : [...currentErrors, bounded.value];
  return {
    errors: next.slice(-MAX_DEGRADED_ERRORS),
    countTruncated: next.length > MAX_DEGRADED_ERRORS,
    textTruncated: bounded.truncated,
  };
}

interface BoundedErrors {
  readonly errors: readonly string[];
  readonly collectionValid: boolean;
  readonly countTruncated: boolean;
  readonly textTruncated: boolean;
}

function boundedErrors(errors: unknown): BoundedErrors {
  let current: readonly string[] = [];
  let countTruncated = false;
  let textTruncated = false;

  const collected = collectStringPrefix(errors, MAX_ERROR_INPUT_SCAN);
  for (const error of collected.values) {
    const appended = appendError(current, error);
    current = appended.errors;
    countTruncated ||= appended.countTruncated;
    textTruncated ||= appended.textTruncated;
  }
  countTruncated ||= collected.truncated;

  return {
    errors: current,
    collectionValid: collected.valid,
    countTruncated,
    textTruncated,
  };
}

function emptyTruncationMetadata(): TruncationMetadata {
  return createTruncationMetadata(false);
}

function mergeTruncation(
  current: TruncationMetadata,
  incoming: TruncationMetadata,
  reason: "record_limit" | "serialization_limit",
): TruncationMetadata {
  const truncated = current.truncated || incoming.truncated;
  return createTruncationMetadata(truncated, truncated ? reason : null);
}

function errorTruncation(countTruncated: boolean, textTruncated: boolean): TruncationMetadata {
  if (countTruncated) return createTruncationMetadata(true, "record_limit");
  if (textTruncated) return createTruncationMetadata(true, "serialization_limit");
  return emptyTruncationMetadata();
}

function nonEmptyFingerprint(value: unknown, prefix: string): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  const canonical = new RegExp(`^${prefix}_[0-9a-f]{64}$`);
  return canonical.test(value) ? value : fingerprintDigest(prefix, value);
}

function normalizedTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(normalized);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = match[7] === undefined ? 0 : Number(match[7]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    millisecond <= 999
    ? normalized
    : null;
}

function statusWith(
  status: ProjectStatus,
  changes: Partial<Omit<ProjectStatus, "project">>,
): ProjectStatus {
  return { ...status, ...changes };
}

function normalizeTruncation(
  current: unknown,
  derived: TruncationMetadata,
  fallbackReason: "record_limit" | "serialization_limit",
  acceptedReasons: readonly TruncationReason[] = [fallbackReason],
): TruncationMetadata {
  const record =
    typeof current === "object" && current !== null
      ? (current as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const currentTruncated = record.truncated === true;
  const currentReason =
    isTruncationReason(record.reason) && acceptedReasons.includes(record.reason)
      ? record.reason
      : null;
  const truncated = currentTruncated || derived.truncated;
  if (!truncated) return emptyTruncationMetadata();
  return createTruncationMetadata(true, currentReason ?? derived.reason ?? fallbackReason);
}

function isValidTruncationMetadata(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.truncated !== "boolean") return false;
  return record.truncated ? isTruncationReason(record.reason) : record.reason === null;
}

function invalidProjectStatus(): ProjectStatus {
  return {
    project: normalizeProjectIdentity(null),
    state: "degraded",
    causes: [],
    sourceCount: 0,
    indexedCount: 0,
    pendingFiles: [],
    pendingFilesTruncated: false,
    pendingFilesTruncation: emptyTruncationMetadata(),
    pendingFilesFilenameTruncation: emptyTruncationMetadata(),
    compiler: { state: "failed" },
    index: { state: "disabled" },
    watcher: { state: "disabled" },
    lastSuccessfulSyncAt: null,
    lastSuccessfulIndexAt: null,
    sourceSnapshotFingerprint: null,
    configSnapshotFingerprint: null,
    canonicalSnapshotFingerprint: null,
    degradedErrors: ["[invalid-status]"],
    degradedErrorsTruncation: emptyTruncationMetadata(),
    degradedErrorsTextTruncation: emptyTruncationMetadata(),
    boundaryInvalid: true,
  };
}

function normalizeProjectStatus(status: ProjectStatus): ProjectStatus {
  if (typeof status !== "object" || status === null || Array.isArray(status)) {
    return invalidProjectStatus();
  }
  const causeCollection = collectStringPrefix(status.causes, MAX_STATUS_CAUSES * 4);
  const causesFromInput = causeCollection.values
    .filter(isFreshnessCause)
    .filter((cause, index, causes) => causes.indexOf(cause) === index);
  const hasMalformedCause =
    !causeCollection.valid ||
    causeCollection.truncated ||
    causeCollection.values.some((cause) => !isFreshnessCause(cause));
  const rawIndexState = status.index?.state;
  const rawWatcherState = status.watcher?.state;
  const rawCompilerState = status.compiler?.state;
  const malformedCount = !isFiniteCount(status.sourceCount) || !isFiniteCount(status.indexedCount);
  const indexFailed = !isIndexStatusState(rawIndexState) || rawIndexState === "failed";
  const watcherFailed = !isWatcherStatusState(rawWatcherState) || rawWatcherState === "failed";
  const malformedComponentState =
    !isIndexStatusState(rawIndexState) || !isWatcherStatusState(rawWatcherState);
  const compilerValid = isCompilerStatusState(rawCompilerState);
  const compilerFailed = rawCompilerState === "failed";
  const compilerRebuilding = rawCompilerState === "rebuilding";
  const sourceSnapshotFingerprint = nonEmptyFingerprint(status.sourceSnapshotFingerprint, "source");
  const configSnapshotFingerprint = nonEmptyFingerprint(status.configSnapshotFingerprint, "config");
  const canonicalSnapshotFingerprint = nonEmptyFingerprint(
    status.canonicalSnapshotFingerprint,
    "snapshot",
  );
  const lastSuccessfulSyncAt = normalizedTimestamp(status.lastSuccessfulSyncAt);
  const hasCompleteSnapshotEvidence =
    canonicalSnapshotFingerprint !== null ||
    (sourceSnapshotFingerprint !== null && configSnapshotFingerprint !== null);
  const hasActiveInvalidationCause = causesFromInput.some(
    (cause) =>
      cause === "source_change" || cause === "config_change" || cause === "compiler_rebuild",
  );
  let causes: readonly ProjectStatusCause[] = causesFromInput;
  if (indexFailed) causes = appendCause(causes, "index_failure");
  if (watcherFailed) causes = appendCause(causes, "watcher_failure");
  const hasComponentFailure =
    causes.includes("index_failure") ||
    causes.includes("watcher_failure") ||
    indexFailed ||
    watcherFailed ||
    (compilerFailed && status.state === "fresh");
  const pendingCollection = collectStringPrefix(status.pendingFiles, MAX_PENDING_INPUT_SCAN);
  const pending = boundedPendingFiles(status.pendingFiles);
  const bounded = boundedErrors(status.degradedErrors);
  const malformedTruncation = [
    status.pendingFilesTruncation,
    status.pendingFilesFilenameTruncation,
    status.degradedErrorsTruncation,
    status.degradedErrorsTextTruncation,
  ].some((metadata) => !isValidTruncationMetadata(metadata));
  const boundaryInvalid =
    status.boundaryInvalid === true ||
    hasMalformedCause ||
    malformedCount ||
    malformedComponentState ||
    !pendingCollection.valid ||
    !bounded.collectionValid ||
    malformedTruncation ||
    !isSnapshotState(status.state) ||
    !compilerValid;
  const pendingFilesTruncation = normalizeTruncation(
    status.pendingFilesTruncation,
    pending.recordTruncation,
    "record_limit",
  );
  const pendingFilesFilenameTruncation = normalizeTruncation(
    status.pendingFilesFilenameTruncation,
    pending.filenameTruncation,
    "serialization_limit",
  );
  const degradedErrorsTruncation = normalizeTruncation(
    status.degradedErrorsTruncation,
    errorTruncation(bounded.countTruncated, bounded.textTruncated),
    "record_limit",
    ["record_limit", "serialization_limit"],
  );
  const degradedErrorsTextTruncation = normalizeTruncation(
    status.degradedErrorsTextTruncation,
    createTruncationMetadata(
      bounded.textTruncated,
      bounded.textTruncated ? "serialization_limit" : null,
    ),
    "serialization_limit",
  );
  const hasPendingEvidence =
    pending.files.length > 0 ||
    pendingFilesTruncation.truncated ||
    pendingFilesFilenameTruncation.truncated;

  return {
    ...status,
    project: normalizeProjectIdentity(status.project),
    state:
      hasComponentFailure || boundaryInvalid
        ? "degraded"
        : status.state === "fresh" &&
            (!hasCompleteSnapshotEvidence ||
              lastSuccessfulSyncAt === null ||
              hasActiveInvalidationCause ||
              hasPendingEvidence ||
              compilerRebuilding ||
              bounded.errors.length > 0)
          ? "pending"
          : status.state,
    causes,
    boundaryInvalid,
    sourceCount: boundedCount(status.sourceCount),
    indexedCount: rawIndexState === "disabled" ? 0 : boundedCount(status.indexedCount),
    index: { state: isIndexStatusState(rawIndexState) ? rawIndexState : "failed" },
    compiler: { state: compilerValid ? rawCompilerState : "failed" },
    watcher: { state: watcherFailed ? "failed" : rawWatcherState },
    lastSuccessfulSyncAt,
    lastSuccessfulIndexAt:
      rawIndexState === "disabled" ? null : normalizedTimestamp(status.lastSuccessfulIndexAt),
    sourceSnapshotFingerprint,
    configSnapshotFingerprint,
    canonicalSnapshotFingerprint,
    pendingFiles: pending.files,
    pendingFilesTruncated:
      pendingFilesTruncation.truncated || pendingFilesFilenameTruncation.truncated,
    pendingFilesTruncation,
    pendingFilesFilenameTruncation,
    degradedErrors: bounded.errors,
    degradedErrorsTruncation,
    degradedErrorsTextTruncation,
  };
}

function hasActiveIndexFailure(status: ProjectStatus): boolean {
  return status.causes.includes("index_failure");
}

function hasActiveWatcherFailure(status: ProjectStatus): boolean {
  return status.causes.includes("watcher_failure");
}

function hasActiveComponentFailure(status: ProjectStatus): boolean {
  return (
    hasActiveIndexFailure(status) ||
    hasActiveWatcherFailure(status) ||
    status.boundaryInvalid === true ||
    status.index.state === "failed" ||
    status.watcher.state === "failed"
  );
}

function stateAfterRecovery(status: ProjectStatus): ProjectStatusState {
  return hasActiveComponentFailure(status) ? "degraded" : "pending";
}

function markInvalidTransition(status: ProjectStatus, error: unknown): ProjectStatus {
  const appended = appendError(status.degradedErrors, error);
  const textTruncated = status.degradedErrorsTextTruncation.truncated || appended.textTruncated;
  const countTruncated =
    status.degradedErrorsTruncation.reason === "record_limit" || appended.countTruncated;
  return statusWith(status, {
    state: "degraded",
    boundaryInvalid: true,
    degradedErrors: appended.errors,
    degradedErrorsTruncation: errorTruncation(countTruncated, textTruncated),
    degradedErrorsTextTruncation: createTruncationMetadata(
      textTruncated,
      textTruncated ? "serialization_limit" : null,
    ),
  });
}

export function createInitialProjectStatus(
  project: ProjectIdentity,
  options: CreateProjectStatusOptions = {},
): ProjectStatus {
  const pendingInput = options.pendingFiles === undefined ? [] : options.pendingFiles;
  const pendingInputCollection = collectStringPrefix(pendingInput, MAX_PENDING_INPUT_SCAN);
  const pending = boundedPendingFiles(pendingInput);
  const watcherState = options.watcherState === undefined ? "disabled" : options.watcherState;

  const initial: ProjectStatus = {
    project: { ...project },
    state: "pending",
    causes: pending.files.length > 0 ? ["source_change"] : [],
    sourceCount: boundedCount(options.sourceCount),
    indexedCount: 0,
    pendingFiles: pending.files,
    pendingFilesTruncated:
      pending.recordTruncation.truncated || pending.filenameTruncation.truncated,
    pendingFilesTruncation: pending.recordTruncation,
    pendingFilesFilenameTruncation: pending.filenameTruncation,
    compiler: { state: "ready" },
    index: { state: "disabled" },
    watcher: { state: watcherState },
    lastSuccessfulSyncAt: null,
    lastSuccessfulIndexAt: null,
    sourceSnapshotFingerprint: null,
    configSnapshotFingerprint: null,
    canonicalSnapshotFingerprint: null,
    degradedErrors: [],
    degradedErrorsTruncation: emptyTruncationMetadata(),
    degradedErrorsTextTruncation: emptyTruncationMetadata(),
    boundaryInvalid:
      !pendingInputCollection.valid ||
      (options.sourceCount !== undefined && !isFiniteCount(options.sourceCount)) ||
      (options.indexedCount !== undefined && !isFiniteCount(options.indexedCount)),
  };

  return normalizeProjectStatus(initial);
}

export function transitionProjectStatus(
  inputStatus: ProjectStatus,
  event: ProjectStatusEvent,
): ProjectStatus {
  const status = normalizeProjectStatus(inputStatus);
  const runtimeEvent = event as unknown;
  if (
    typeof runtimeEvent !== "object" ||
    runtimeEvent === null ||
    typeof (runtimeEvent as { type?: unknown }).type !== "string"
  ) {
    return markInvalidTransition(status, "[invalid-event]");
  }

  switch (event.type) {
    case "source_changed": {
      const eventFiles = collectStringPrefix(event.files, MAX_PENDING_INPUT_SCAN);
      if (!eventFiles.valid) return markInvalidTransition(status, "[invalid-files]");
      const pending = mergePendingFiles(status.pendingFiles, event.files);
      const recordTruncation = mergeTruncation(
        status.pendingFilesTruncation,
        pending.recordTruncation,
        "record_limit",
      );
      const filenameTruncation = mergeTruncation(
        status.pendingFilesFilenameTruncation,
        pending.filenameTruncation,
        "serialization_limit",
      );
      return statusWith(status, {
        state: status.state === "degraded" ? "degraded" : "pending",
        causes: appendCause(status.causes, "source_change"),
        pendingFiles: pending.files,
        pendingFilesTruncated: recordTruncation.truncated || filenameTruncation.truncated,
        pendingFilesTruncation: recordTruncation,
        pendingFilesFilenameTruncation: filenameTruncation,
      });
    }

    case "config_changed":
      return statusWith(status, {
        state: status.state === "degraded" ? "degraded" : "pending",
        causes: appendCause(status.causes, "config_change"),
      });

    case "compiler_rebuild_started":
      return statusWith(status, {
        state: status.state === "degraded" ? "degraded" : "rebuilding",
        causes: appendCause(status.causes, "compiler_rebuild"),
        compiler: { state: "rebuilding" },
        index: {
          state:
            status.index.state === "failed"
              ? "failed"
              : status.index.state === "disabled"
                ? "disabled"
                : "rebuilding",
        },
      });

    case "sync_succeeded": {
      if (!isFiniteCount(event.sourceCount) || !isFiniteCount(event.indexedCount)) {
        return markInvalidTransition(status, "[invalid-count]");
      }
      const hasFailure = hasActiveComponentFailure(status);
      const indexUnavailable =
        hasActiveIndexFailure(status) ||
        status.index.state === "disabled" ||
        status.index.state === "failed";
      const sourceSnapshotFingerprint = nonEmptyFingerprint(
        event.sourceSnapshotFingerprint,
        "source",
      );
      const configSnapshotFingerprint = nonEmptyFingerprint(
        event.configSnapshotFingerprint,
        "config",
      );
      const canonicalSnapshotFingerprint = nonEmptyFingerprint(
        event.canonicalSnapshotFingerprint,
        "snapshot",
      );
      const hasSnapshotEvidence =
        sourceSnapshotFingerprint !== null ||
        configSnapshotFingerprint !== null ||
        canonicalSnapshotFingerprint !== null;
      const hasCompleteSnapshotEvidence =
        canonicalSnapshotFingerprint !== null ||
        (sourceSnapshotFingerprint !== null && configSnapshotFingerprint !== null);
      const eventSyncAt =
        event.at === undefined ? status.lastSuccessfulSyncAt : normalizedTimestamp(event.at);
      const nextSyncAt =
        event.at === undefined
          ? status.lastSuccessfulSyncAt
          : (normalizedTimestamp(event.at) ?? status.lastSuccessfulSyncAt);
      const hasFreshEvidence = hasCompleteSnapshotEvidence && eventSyncAt !== null;
      const canClearInvalidation = !hasFailure && hasFreshEvidence;
      const pending = canClearInvalidation
        ? boundedPendingFiles([])
        : {
            files: status.pendingFiles,
            recordTruncation: status.pendingFilesTruncation,
            filenameTruncation: status.pendingFilesFilenameTruncation,
          };
      const nextState = hasFailure ? "degraded" : canClearInvalidation ? "fresh" : "pending";
      return statusWith(status, {
        state: nextState,
        causes: canClearInvalidation ? [] : status.causes,
        sourceCount: boundedCount(event.sourceCount),
        indexedCount: indexUnavailable ? 0 : boundedCount(event.indexedCount),
        pendingFiles: pending.files,
        pendingFilesTruncated:
          pending.recordTruncation.truncated || pending.filenameTruncation.truncated,
        pendingFilesTruncation: pending.recordTruncation,
        pendingFilesFilenameTruncation: pending.filenameTruncation,
        compiler: { state: "ready" },
        index: {
          state:
            hasFailure && status.index.state === "failed"
              ? "failed"
              : indexUnavailable
                ? "disabled"
                : "ready",
        },
        lastSuccessfulSyncAt: canClearInvalidation ? nextSyncAt : status.lastSuccessfulSyncAt,
        lastSuccessfulIndexAt:
          !hasFreshEvidence || indexUnavailable
            ? status.lastSuccessfulIndexAt
            : (nextSyncAt ?? status.lastSuccessfulIndexAt),
        sourceSnapshotFingerprint: hasSnapshotEvidence
          ? (sourceSnapshotFingerprint ?? status.sourceSnapshotFingerprint)
          : status.sourceSnapshotFingerprint,
        configSnapshotFingerprint: hasSnapshotEvidence
          ? (configSnapshotFingerprint ?? status.configSnapshotFingerprint)
          : status.configSnapshotFingerprint,
        canonicalSnapshotFingerprint: hasSnapshotEvidence
          ? (canonicalSnapshotFingerprint ?? status.canonicalSnapshotFingerprint)
          : status.canonicalSnapshotFingerprint,
        degradedErrors: canClearInvalidation ? [] : status.degradedErrors,
        degradedErrorsTruncation: canClearInvalidation
          ? emptyTruncationMetadata()
          : status.degradedErrorsTruncation,
        degradedErrorsTextTruncation: canClearInvalidation
          ? emptyTruncationMetadata()
          : status.degradedErrorsTextTruncation,
      });
    }

    case "sync_failed":
      if (!isSynchronizationCause(event.cause)) {
        return markInvalidTransition(status, event.error);
      }
      return statusWith(status, {
        state: hasActiveComponentFailure(status) ? "degraded" : "stale",
        causes: appendCause(status.causes, event.cause),
        compiler: { state: "failed" },
      });

    case "stale_detected": {
      const cause = event.cause === undefined ? "source_change" : event.cause;
      const eventFiles =
        event.files === undefined
          ? { valid: true }
          : collectStringPrefix(event.files, MAX_PENDING_INPUT_SCAN);
      if (!eventFiles.valid) return markInvalidTransition(status, "[invalid-files]");
      const pending = mergePendingFiles(status.pendingFiles, event.files);
      const recordTruncation = mergeTruncation(
        status.pendingFilesTruncation,
        pending.recordTruncation,
        "record_limit",
      );
      const filenameTruncation = mergeTruncation(
        status.pendingFilesFilenameTruncation,
        pending.filenameTruncation,
        "serialization_limit",
      );
      const next = statusWith(status, {
        state: hasActiveComponentFailure(status) ? "degraded" : "stale",
        causes: isSynchronizationCause(cause) ? appendCause(status.causes, cause) : status.causes,
        pendingFiles: pending.files,
        pendingFilesTruncated: recordTruncation.truncated || filenameTruncation.truncated,
        pendingFilesTruncation: recordTruncation,
        pendingFilesFilenameTruncation: filenameTruncation,
      });
      return isSynchronizationCause(cause) ? next : markInvalidTransition(next, "[invalid-cause]");
    }

    case "index_failed": {
      const appended = appendError(status.degradedErrors, event.error);
      const textTruncated = status.degradedErrorsTextTruncation.truncated || appended.textTruncated;
      const countTruncated =
        status.degradedErrorsTruncation.reason === "record_limit" || appended.countTruncated;
      return statusWith(status, {
        state: "degraded",
        causes: appendCause(status.causes, "index_failure"),
        index: { state: "failed" },
        degradedErrors: appended.errors,
        degradedErrorsTruncation: errorTruncation(countTruncated, textTruncated),
        degradedErrorsTextTruncation: createTruncationMetadata(
          textTruncated,
          textTruncated ? "serialization_limit" : null,
        ),
      });
    }

    case "watcher_failed": {
      const appended = appendError(status.degradedErrors, event.error);
      const textTruncated = status.degradedErrorsTextTruncation.truncated || appended.textTruncated;
      const countTruncated =
        status.degradedErrorsTruncation.reason === "record_limit" || appended.countTruncated;
      return statusWith(status, {
        state: "degraded",
        causes: appendCause(status.causes, "watcher_failure"),
        watcher: { state: "failed" },
        degradedErrors: appended.errors,
        degradedErrorsTruncation: errorTruncation(countTruncated, textTruncated),
        degradedErrorsTextTruncation: createTruncationMetadata(
          textTruncated,
          textTruncated ? "serialization_limit" : null,
        ),
      });
    }

    case "component_recovered":
      if (event.component !== "index" && event.component !== "watcher") {
        return markInvalidTransition(status, "[invalid-component]");
      }
      return recoverComponent(status, event.component);

    case "index_recovered":
      return recoverComponent(status, "index");

    case "index_ready":
      return statusWith(status, { index: { state: "ready" } });

    case "index_disabled":
      return statusWith(status, {
        index: { state: "disabled" },
        indexedCount: 0,
        lastSuccessfulIndexAt: null,
        causes: removeCause(status.causes, "index_failure"),
      });

    case "watcher_recovered":
      return recoverComponent(status, "watcher");

    default:
      return markInvalidTransition(status, "[invalid-event]");
  }
}

function recoverComponent(status: ProjectStatus, component: "index" | "watcher"): ProjectStatus {
  const recovered =
    component === "index"
      ? statusWith(status, {
          index: { state: status.index.state === "failed" ? "ready" : status.index.state },
          causes: removeCause(status.causes, "index_failure"),
        })
      : statusWith(status, {
          watcher: { state: "ready" },
          causes: removeCause(status.causes, "watcher_failure"),
        });
  const state = stateAfterRecovery(recovered);

  return statusWith(recovered, {
    state,
    degradedErrors: state === "degraded" ? recovered.degradedErrors : [],
    degradedErrorsTruncation:
      state === "degraded" ? recovered.degradedErrorsTruncation : emptyTruncationMetadata(),
    degradedErrorsTextTruncation:
      state === "degraded" ? recovered.degradedErrorsTextTruncation : emptyTruncationMetadata(),
  });
}

export function projectStatusToProjection(status: ProjectStatus): ProjectStatusProjection {
  const normalized = normalizeProjectStatus(status);
  return {
    project: { ...normalized.project },
    state: normalized.state,
    causes: [...normalized.causes],
    source_count: normalized.sourceCount,
    indexed_count: normalized.indexedCount,
    pending_files: [...normalized.pendingFiles],
    pending_files_truncated: normalized.pendingFilesTruncated,
    pending_files_truncation: { ...normalized.pendingFilesTruncation },
    pending_files_filename_truncation: { ...normalized.pendingFilesFilenameTruncation },
    compiler: { ...normalized.compiler },
    index: { ...normalized.index },
    watcher: { ...normalized.watcher },
    last_successful_sync_at: normalized.lastSuccessfulSyncAt,
    last_successful_index_at: normalized.lastSuccessfulIndexAt,
    source_snapshot_fingerprint: normalized.sourceSnapshotFingerprint,
    config_snapshot_fingerprint: normalized.configSnapshotFingerprint,
    canonical_snapshot_fingerprint: normalized.canonicalSnapshotFingerprint,
    degraded_errors: [...normalized.degradedErrors],
    degraded_errors_truncation: { ...normalized.degradedErrorsTruncation },
    degraded_errors_text_truncation: { ...normalized.degradedErrorsTextTruncation },
  };
}

const OPERATION_QUEUE_FIELDS = Object.freeze([
  "admission",
  "queue_capacity",
  "active_operations",
  "queued_operations",
  "rejected_operations",
  "cancelled_operations",
  "queue_timeout_operations",
  "deadline_exceeded_operations",
  "last_outcome",
  "max_queue_wait_ms",
  "max_execution_ms",
] as const);

function operationQueueRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};

  try {
    if (utilTypes.isProxy(value) || Array.isArray(value)) return {};
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return {};

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === "symbol")) return {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of ownKeys) {
      const descriptor = descriptors[key as string];
      if (!descriptor?.enumerable || !("value" in descriptor)) return {};
    }

    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const field of OPERATION_QUEUE_FIELDS) {
      const descriptor = descriptors[field];
      if (descriptor && "value" in descriptor) record[field] = descriptor.value;
    }
    return record;
  } catch {
    return {};
  }
}

function normalizeQueueCapacity(value: unknown, configuredCapacity: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 256) {
    return value;
  }
  if (
    typeof configuredCapacity === "number" &&
    Number.isSafeInteger(configuredCapacity) &&
    configuredCapacity >= 1 &&
    configuredCapacity <= 256
  ) {
    return configuredCapacity;
  }
  return 32;
}

function normalizeRuntimeMetric(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return 0;
  if (value < 0) return 0;
  return Math.min(value, maximum);
}

function normalizeOperationOutcome(value: unknown): ProjectOperationOutcome {
  if (
    value === "none" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "rejected" ||
    value === "cancelled" ||
    value === "queue_timeout" ||
    value === "deadline_exceeded" ||
    value === "internal_error"
  ) {
    return value;
  }
  return "internal_error";
}

export function projectOperationQueueToProjection(
  input: unknown,
  configuredCapacity: unknown,
): ProjectOperationQueueProjection {
  const record = operationQueueRecord(input);
  const queueCapacity = normalizeQueueCapacity(record.queue_capacity, configuredCapacity);
  const activeOperations = normalizeRuntimeMetric(record.active_operations, 1);
  const queuedOperations = normalizeRuntimeMetric(record.queued_operations, queueCapacity);
  const state: ProjectQueueState =
    activeOperations > 0 ? "running" : queuedOperations > 0 ? "queued" : "idle";

  return Object.freeze({
    state,
    admission: record.admission === "open" ? "open" : "closed",
    queue_capacity: queueCapacity,
    active_operations: activeOperations,
    queued_operations: queuedOperations,
    rejected_operations: normalizeRuntimeMetric(
      record.rejected_operations,
      MAX_PROJECT_OPERATION_COUNTER,
    ),
    cancelled_operations: normalizeRuntimeMetric(
      record.cancelled_operations,
      MAX_PROJECT_OPERATION_COUNTER,
    ),
    queue_timeout_operations: normalizeRuntimeMetric(
      record.queue_timeout_operations,
      MAX_PROJECT_OPERATION_COUNTER,
    ),
    deadline_exceeded_operations: normalizeRuntimeMetric(
      record.deadline_exceeded_operations,
      MAX_PROJECT_OPERATION_COUNTER,
    ),
    last_outcome: normalizeOperationOutcome(record.last_outcome),
    max_queue_wait_ms: normalizeRuntimeMetric(
      record.max_queue_wait_ms,
      MAX_PROJECT_OPERATION_DURATION_MS,
    ),
    max_execution_ms: normalizeRuntimeMetric(
      record.max_execution_ms,
      MAX_PROJECT_OPERATION_DURATION_MS,
    ),
  });
}
