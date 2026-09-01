import type { ChildProcess } from "node:child_process";
import type { SpawnOptions } from "node:child_process";

export interface BoundedCommandOptions extends SpawnOptions {
  timeout?: number;
  maxBuffer?: number;
}

export function terminateProcessTree(child: ChildProcess): Promise<void>;
export function sanitizeDiagnosticText(value: unknown): string;
// prettier-ignore
export function runOrderedCleanup(label: string, steps: ReadonlyArray<readonly [string, () => unknown | Promise<unknown>]>): Promise<void>;
export function runBoundedCommand(
  command: string,
  args: readonly string[],
  options?: BoundedCommandOptions,
): Promise<{ stdout: string; stderr: string }>;
// prettier-ignore
export function createH03CleanupEvidence(h03: { rawMarkerSha256: string; readback: unknown } | undefined): { rawMarkerSha256: string; controllerReadback: unknown; ownedProcesses: 0; profileAndControlRemoved: true } | undefined;
export function requireExactIdentity<T extends Record<string, unknown>>(
  observed: T,
  expected: Readonly<Partial<T>>,
): T;
export function classifyExactHostToolError(result: unknown): {
  code: "QUEUE_WAIT_TIMEOUT" | "OPERATION_DEADLINE_EXCEEDED" | "REQUEST_CANCELLED";
  correlationId: string;
  message: string;
  envelopeBytes: number;
  name: unknown;
};
export function parseProbeMarker(
  stderr: string,
):
  | { status: "missing" }
  | { status: "invalid"; detail: string }
  | { status: "found"; value: unknown };
