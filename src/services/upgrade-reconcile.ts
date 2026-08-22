import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

interface ReconcileOptions {
  nodeExecutable?: string;
  execute?: (
    executable: string,
    args: readonly string[],
    options: { encoding: "utf8"; windowsHide: true; env: NodeJS.ProcessEnv },
  ) => Promise<{ stdout: string; stderr: string }>;
  environment?: NodeJS.ProcessEnv;
}

const executeFile = promisify(execFile) as unknown as NonNullable<ReconcileOptions["execute"]>;

export class ReconciliationError extends Error {
  constructor(readonly code: "AGENT_SKILL_CONFLICT" | "UPGRADE_RECONCILIATION_FAILED") {
    super("The updated package requires managed setup reconciliation.");
    this.name = "ReconciliationError";
  }
}

export async function reconcileUpgrade(
  executable: string,
  options: ReconcileOptions = {},
): Promise<void> {
  const execute = options.execute ?? executeFile;
  try {
    await execute(
      options.nodeExecutable ?? process.execPath,
      [executable, "setup", "--agents", "all", "--yes"],
      {
        encoding: "utf8",
        windowsHide: true,
        env: options.environment ?? process.env,
      },
    );
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "")
        : "";
    try {
      const failure: unknown = JSON.parse(stderr);
      if (
        typeof failure === "object" &&
        failure !== null &&
        "code" in failure &&
        failure.code === "AGENT_SKILL_CONFLICT"
      ) {
        throw new ReconciliationError("AGENT_SKILL_CONFLICT");
      }
    } catch (parsed) {
      if (parsed instanceof ReconciliationError) throw parsed;
    }
    throw new ReconciliationError("UPGRADE_RECONCILIATION_FAILED");
  }
}
