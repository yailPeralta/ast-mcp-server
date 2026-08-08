/// <reference types="node" />

export interface ParsedCanaryArguments {
  readonly mode: "run" | "freeze-report";
  readonly expectedNode: string;
  readonly iterations: number;
  readonly restarts: number;
  readonly nodeOptions: readonly string[];
  readonly reportArgv: readonly string[];
  readonly [key: string]: unknown;
}

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

export function parseCanaryArguments(argv: readonly string[]): ParsedCanaryArguments;
export function assertExpectedNodeVersion(expected: string, observed: string): void;
export function validateWorkloadManifest(value: unknown): CanaryWorkloadManifest;
export function canonicalizeToolResult<T>(value: T): T;
export function assertRepositoryStatusUnchanged(before: Buffer, after: Buffer): void;
export function inspectCacheTree(root: string): Promise<CacheTreeInspection>;
export function canonicalizeCanaryReport(
  report: unknown,
  checkedRelativePath: string,
  rawSha256: string,
): Readonly<Record<string, unknown>>;
export function freezeCanaryReport(
  inputPath: string,
  outputPath: string,
): Promise<Readonly<Record<string, unknown>>>;
export function runCanary(
  options: ParsedCanaryArguments,
): Promise<Readonly<Record<string, unknown>>>;
export function runDeterministicFixture(
  options: Readonly<{
    nodeBin: string;
    expectedNode: string;
    nodeOptions: readonly string[];
  }>,
): Promise<Readonly<Record<string, unknown>>>;
