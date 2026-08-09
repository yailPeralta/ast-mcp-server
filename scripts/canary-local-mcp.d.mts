/// <reference types="node" />

export type CanaryRuntimeSelector = "22.5.0" | "24";
export type CanaryReportSetInputKey =
  "astNode24" | "astNode22_5" | "xScraperNode24" | "xScraperNode22_5";

export interface CanaryReportSetInputs {
  readonly astNode24: string;
  readonly astNode22_5: string;
  readonly xScraperNode24: string;
  readonly xScraperNode22_5: string;
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

export interface CanaryReportSet {
  readonly astNode24: CanonicalCanaryReport;
  readonly astNode22_5: CanonicalCanaryReport;
  readonly xScraperNode24: CanonicalCanaryReport;
  readonly xScraperNode22_5: CanonicalCanaryReport;
}

export function parseCanaryArguments(argv: readonly string[]): ParsedCanaryArguments;
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
