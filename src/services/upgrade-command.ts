import { inspectUpgrade, performUpgrade, UpgradeError, type UpgradeRuntime } from "./upgrade.js";
import { ReconciliationError } from "./upgrade-reconcile.js";
import { UpgradeCleanupError, type UpgradeRuntimeLease } from "./upgrade-runtime.js";

export class UpgradeCommandError extends Error {
  constructor(readonly code = "UPGRADE_USAGE") {
    super("Usage: ast-tool upgrade [--check]");
    this.name = "UpgradeCommandError";
  }
}

type Reconcile = (executable: string) => Promise<void>;

export async function runUpgradeCommand(
  args: readonly string[],
  runtime: UpgradeRuntime,
  reconcile: Reconcile,
): Promise<unknown> {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
    throw new UpgradeCommandError();
  }
  if (args[0] === "--check") return inspectUpgrade(runtime);
  const updated = await performUpgrade(runtime);
  const { new_cli: newCli, ...result } = updated;
  if (updated.status === "current") return { ...result, reconciliation: "not_required" };
  try {
    await reconcile(newCli);
    return { ...result, reconciliation: "completed" };
  } catch (error) {
    const skillConflict =
      error instanceof ReconciliationError && error.code === "AGENT_SKILL_CONFLICT";
    return {
      ...result,
      status: "partial",
      package_status: "updated",
      reconciliation: "required",
      continuation: skillConflict
        ? "ast-tool setup --agents all --yes --force-skill"
        : "ast-tool setup --agents all --yes",
      restart_required: true,
    };
  }
}

function primaryCode(error: unknown): string {
  return error instanceof UpgradeError || error instanceof UpgradeCommandError
    ? error.code
    : "UPGRADE_ERROR";
}

export async function runUpgradeLease(
  args: readonly string[],
  lease: UpgradeRuntimeLease,
  reconcile: Reconcile,
): Promise<unknown> {
  let result: unknown;
  let primary: unknown;
  try {
    result = await runUpgradeCommand(args, lease.runtime, reconcile);
  } catch (error) {
    primary = error;
  }
  try {
    await lease.dispose();
  } catch {
    if (primary) throw new UpgradeCleanupError(primaryCode(primary));
    const record = result as Record<string, unknown>;
    if (record.status === "updated" || record.package_status === "updated") {
      return {
        ...record,
        status: "partial",
        package_status: "updated",
        cleanup: "required",
        cleanup_code: "UPGRADE_CLEANUP_FAILED",
        continuation: record.continuation ?? "ast-tool upgrade --check",
        restart_required: true,
      };
    }
    throw new UpgradeCleanupError();
  }
  if (primary) throw primary;
  return result;
}
