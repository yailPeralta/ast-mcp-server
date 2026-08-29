import type { ChildProcess } from "node:child_process";
import type { SpawnOptions } from "node:child_process";

export interface BoundedCommandOptions extends SpawnOptions {
  timeout?: number;
  maxBuffer?: number;
}

export function terminateProcessTree(child: ChildProcess): Promise<void>;
export function runBoundedCommand(
  command: string,
  args: readonly string[],
  options?: BoundedCommandOptions,
): Promise<{ stdout: string; stderr: string }>;
export function parseProbeMarker(
  stderr: string,
):
  | { status: "missing" }
  | { status: "invalid"; detail: string }
  | { status: "found"; value: unknown };
