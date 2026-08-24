/// <reference types="node" />

export type CanaryRuntimeSelector = "22.5.0" | "22.13.0" | "24";
export type CanaryReportSetInputKey =
  "astNode24" | "astNode22_13" | "xScraperNode24" | "xScraperNode22_13";

export interface CanaryReportSetInputs {
  readonly astNode24: string;
  readonly astNode22_13: string;
  readonly xScraperNode24: string;
  readonly xScraperNode22_13: string;
}

export interface ParsedCanaryRunArguments {
  readonly mode: "run";
  readonly expectedNode: CanaryRuntimeSelector;
  readonly iterations: number;
  readonly restarts: number;
  readonly nodeOptions: readonly string[];
  readonly reportArgv: readonly string[];
  readonly [key: string]: unknown;
}

export interface ParsedCanaryFreezeReportSetArguments {
  readonly mode: "freeze-report-set";
  readonly xScraperRoot: string;
  readonly inputs: CanaryReportSetInputs;
}

export type ParsedCanaryArguments = ParsedCanaryRunArguments | ParsedCanaryFreezeReportSetArguments;

export interface CanaryWorkloadCall {
  readonly id: string;
  readonly tool: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface CanaryWorkloadManifest {
  readonly schema_version: number;
  readonly project_alias: string;
  readonly measurement_call_id: string;
  readonly calls: readonly CanaryWorkloadCall[];
}

export interface CacheTreeInspection {
  readonly total_bytes: number;
  readonly files: readonly {
    readonly file: string;
    readonly bytes: number;
  }[];
}

export type CanonicalCanaryReport = Readonly<Record<string, unknown>>;

export interface SupervisedWorkerEvent {
  readonly event: "compiler_worker";
  readonly version: 1;
  readonly kind: "idle" | "crash" | "ambiguity";
  readonly generation: number;
  readonly correlation_id?: string;
  readonly count?: number;
}

export interface SupervisedWorkerEvidence {
  readonly schema_version: 1;
  readonly parent_count: 3;
  readonly cycles_per_parent: 3;
  readonly equivalent_reads: boolean;
  readonly stable_fingerprint: boolean;
  readonly sqlite_hits: number;
  readonly reused_files: number;
  readonly rebuilt_files: number;
  readonly minimum_reclaimed_percent: number;
  readonly no_upward_pss_trend: boolean;
  readonly diagnostics_redacted: boolean;
  readonly cycles: readonly Readonly<Record<string, number>>[];
  readonly events: readonly SupervisedWorkerEvent[];
}

export interface CanaryReportSet {
  readonly astNode24: CanonicalCanaryReport;
  readonly astNode22_13: CanonicalCanaryReport;
  readonly xScraperNode24: CanonicalCanaryReport;
  readonly xScraperNode22_13: CanonicalCanaryReport;
}

export function parseCanaryArguments(
  argv: readonly string[],
  options?: Readonly<{ allowHistoricalRuntime?: boolean }>,
): ParsedCanaryArguments;

export function assertExpectedNodeVersion(expected: string, observed: string): void;
export function validateWorkloadManifest(value: unknown): CanaryWorkloadManifest;
export function canonicalizeToolResult<T>(value: T): T;
export function assertRepositoryStatusUnchanged(before: Buffer, after: Buffer): void;
export function inspectCacheTree(root: string): Promise<CacheTreeInspection>;
export function freezeCanaryReportSet(
  inputPaths: CanaryReportSetInputs,
  xScraperRoot: string,
): Promise<CanaryReportSet>;
export function runCanary(options: ParsedCanaryRunArguments): Promise<CanonicalCanaryReport>;
export function runDeterministicFixture(
  options: Readonly<{
    nodeBin: string;
    expectedNode: string;
    nodeOptions: readonly string[];
  }>,
): Promise<CanonicalCanaryReport>;
export function runSupervisedWorkerEvidence(
  options: Readonly<{
    nodeBin: string;
    projectRoot: string;
    cacheRoot: string;
  }>,
): Promise<SupervisedWorkerEvidence>;
